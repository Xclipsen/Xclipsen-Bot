const { Client, Events, GatewayIntentBits, MessageFlags, Partials } = require('discord.js');

const { env } = require('./config/env');
const { commands, commandNames } = require('./config/commands');
const { interactionIds } = require('./config/interactionIds');
const { createStore } = require('./storage/store');
const { createAccessControl } = require('./features/accessControl');
const { createSkyblockUtils } = require('./utils/skyblock');
const { createSkyblockItemEmojiUtils } = require('./utils/skyblockItemEmojis');
const { createMinecraftUtils } = require('./utils/minecraft');
const { createModBackendClient } = require('./utils/modBackend');
const { createHypixelApi } = require('./utils/hypixelApi');
const { createAppEmojis } = require('./utils/appEmojis');
const { guarded } = require('./utils/guarded');
const { createMayorAlerts } = require('./features/mayorAlerts');
const { createJerryRotation } = require('./features/jerryRotation');
const { createModUpdatesService } = require('./features/modUpdates');
const { createEventRemindersService } = require('./features/eventReminders');
const { createMiningEventsService } = require('./features/miningEvents');
const { createWeatherService, WEATHER_ISLAND_SELECT_ID } = require('./features/weather');
const { createReactionRoleService } = require('./features/reactionRoles');
const { createSetupHub } = require('./features/setupHub');
const { createCatacombsFeature } = require('./features/catacombs');
const { createItemEmojiFeature } = require('./features/itemEmoji');
const { createGifFeature } = require('./features/gif');
const { createHelpFeature } = require('./features/help');
const { createNameHistoryFeature } = require('./features/nameHistory');
const { createPlayerUuidFeature } = require('./features/playerUuid');
const { createShitterListFeature } = require('./features/shitterList');
const { createSimulationFeature } = require('./features/simulation');
const { createIrcBridge } = require('./features/minecraft/ircBridge');
const { createHideonleafFeature } = require('./features/hideonleaf');
const { createLinkingFeature } = require('./features/linking');
const { createTrophyFishingFeature } = require('./features/trophyFishing');
const { createBestPestFeature } = require('./features/bestPest');
const { createPestFarmingProfitFeature } = require('./features/pestFarmingProfit');
const { createHarvestFeastFeature } = require('./features/harvestFeast');
const { createPagedLists } = require('./features/pagedLists');
const { createSetupEditor } = require('./features/setupHub/editor');
const { createReactionEditor } = require('./features/setupHub/reactionEditor');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const harvestFeast = createHarvestFeastFeature();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const store = createStore({
  configFilePath: env.CONFIG_FILE_PATH,
  shitterFilePath: env.SHITTER_FILE_PATH,
  stateFilePath: env.STATE_FILE_PATH
});

const accessControl = createAccessControl(env.PRIVILEGED_USER_IDS, store);
const skyblock = createSkyblockUtils();
const itemEmojis = createSkyblockItemEmojiUtils(env);
const minecraft = createMinecraftUtils(env);
const modBackend = createModBackendClient(env);
const hypixelApi = createHypixelApi({ env });
// Item icons and mayor heads (assets/app-emojis); Unicode fallbacks until the sync on ready is done.
const appEmojis = createAppEmojis();
// Minecraft links live only in the mod backend; features that read or change links get it as `linkStore`.
const ircBridge = createIrcBridge({ client, env, linkStore: modBackend });
const pagedLists = createPagedLists();
const jerryRotation = createJerryRotation({ store });
const mayorAlerts = createMayorAlerts({ client, env, store, skyblock, jerryRotation, hypixelApi, appEmojis });
const modUpdates = createModUpdatesService({ client, store, pagedLists });
const eventReminders = createEventRemindersService({ client, store, minecraft: ircBridge, mayorAlerts, jerryRotation, feastProvider: harvestFeast, appEmojis });
const miningEvents = createMiningEventsService({ client, store, appEmojis });
const reactionRoles = createReactionRoleService({
  pagedLists,
  client,
  store,
  ensureServerAccess: accessControl.ensureServerAccess
});
const weather = createWeatherService({ client, store, reactionRoles, appEmojis });
const setupHub = createSetupHub({
  store,
  ensureSetupAccess: accessControl.ensureSetupAccess,
  mayorAlerts,
  reactionRoles,
  interactionIds,
  appEmojis
});
const setupEditor = createSetupEditor({ store, accessControl, setupHub, mayorAlerts, modUpdates, miningEvents, pagedLists, weather });
const reactionEditor = createReactionEditor({ store, reactionRoles, accessControl, setupEditor, setupHub });

const catacombs = createCatacombsFeature({ env, minecraft, linkStore: modBackend, hypixelApi, appEmojis });
const itemEmoji = createItemEmojiFeature({ itemEmojis });
const trophyFishing = createTrophyFishingFeature({ minecraft, linkStore: modBackend, hypixelApi });
const bestPest = createBestPestFeature({ store, hypixelApi });
const pestFarmingProfit = createPestFarmingProfitFeature({ store, hypixelApi });
const gif = createGifFeature();
const help = createHelpFeature();
const nameHistory = createNameHistoryFeature({ minecraft, linkStore: modBackend });
const playerUuid = createPlayerUuidFeature({ minecraft, linkStore: modBackend });
const shitterList = createShitterListFeature({ pagedLists, store, linkStore: modBackend, accessControl });
const simulation = createSimulationFeature({ store });
const hideonleaf = createHideonleafFeature({ store: modBackend });
const linking = createLinkingFeature({ linkStore: modBackend, env, minecraft });

const LOGIN_RETRY_BASE_DELAY_MS = 5_000;
// The first start uploads every icon; the scheduled checks wait at most this long for it.
const APP_EMOJI_SYNC_WAIT_MS = 60_000;
const LOGIN_RETRY_MAX_DELAY_MS = 60_000;
const RETRIABLE_LOGIN_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT'
]);

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Resolves when the promise settles or after ms; the promise keeps running in the background.
function waitAtMost(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([promise.catch(() => {}), timeout]).finally(() => clearTimeout(timer));
}

function getErrorCode(error) {
  return error?.code || error?.cause?.code || error?.request?.code;
}

function isRetriableLoginError(error) {
  return RETRIABLE_LOGIN_ERROR_CODES.has(getErrorCode(error));
}

async function loginWithRetry() {
  let retryDelayMs = LOGIN_RETRY_BASE_DELAY_MS;

  while (!client.isReady()) {
    try {
      await client.login(env.DISCORD_TOKEN);
      return;
    } catch (error) {
      if (!isRetriableLoginError(error)) {
        throw error;
      }

      const errorCode = getErrorCode(error) || 'unknown';
      console.error(
        `Discord login failed with ${errorCode}; retrying in ${Math.round(retryDelayMs / 1000)} seconds.`,
        error
      );
      await wait(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, LOGIN_RETRY_MAX_DELAY_MS);
    }
  }
}

const scheduledChecks = [
  [guarded('Election state check', () => mayorAlerts.checkElectionState()), env.CHECK_INTERVAL_MINUTES * 60_000],
  [guarded('Scheduled status update', () => mayorAlerts.sendScheduledStatusUpdate()), env.STATUS_UPDATE_MINUTES * 60_000],
  [guarded('Mod update check', () => modUpdates.checkForUpdates()), env.MOD_UPDATE_CHECK_MINUTES * 60_000],
  [guarded('Event reminder check', () => eventReminders.checkForReminders()), 60_000],
  [guarded('Mining event check', () => miningEvents.checkForMiningEvents()), 60_000],
  [guarded('Weather check', () => weather.checkForWeather()), 60_000]
];

// Open to everyone who can see the weather dashboard; the answer is ephemeral.
async function handleWeatherIslandSelect(interaction) {
  try {
    await weather.handleIslandSelect(interaction);
  } catch (error) {
    console.error('Weather island select failed:', error);
    const content = 'Could not show the weather details. Please try again.';
    if (interaction.deferred) {
      await interaction.editReply({ content, files: [] }).catch(() => {});
    } else if (!interaction.replied) {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

async function registerGuildCommands(guild) {
  console.log(`Registering commands for guild ${guild.id} (${guild.name})`);
  await guild.commands.set(commands.map((command) => command.toJSON()));
  console.log(`Registered commands for guild ${guild.id} (${guild.name})`);
}

async function setUpGuild(guild, { ensurePanels }) {
  try {
    await registerGuildCommands(guild);
    if (ensurePanels) {
      await setupEditor.ensurePanels(guild);
    }
  } catch (error) {
    console.error(`Guild setup failed for ${guild.id} (${guild.name}):`, error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Connected guilds: ${readyClient.guilds.cache.map((guild) => `${guild.id} (${guild.name})`).join(', ')}`);

  await mayorAlerts.ensureLegacyEnvConfig().catch((error) => console.error('Legacy env config migration failed:', error));

  // Before the panel check: role panels react with the item icons and are rebuilt when they still use other emojis.
  await waitAtMost(appEmojis.sync(readyClient), APP_EMOJI_SYNC_WAIT_MS);

  for (const guild of readyClient.guilds.cache.values()) {
    await setUpGuild(guild, { ensurePanels: true });
  }

  for (const [runCheck] of scheduledChecks) {
    await runCheck();
  }

  await ircBridge.start().catch((error) => console.error('IRC bridge failed to start:', error));

  for (const [runCheck, intervalMs] of scheduledChecks) {
    setInterval(() => void runCheck(), intervalMs);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined guild ${guild.id} (${guild.name})`);
  await setUpGuild(guild, { ensurePanels: false });
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await reactionRoles.applyReactionRoleChange(reaction, user, true);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await reactionRoles.applyReactionRoleChange(reaction, user, false);
});

client.on(Events.MessageCreate, async (message) => {
  await ircBridge.handleDiscordMessage(message);
});

async function handleSimulateCommand(interaction) {
  if (!(await accessControl.ensureSetupAccess(interaction, 'simulate command'))) {
    return;
  }

  await simulation.handleSimulateCommand(interaction, mayorAlerts);
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleTestCommand(interaction) {
  if (!(await accessControl.ensureSetupAccess(interaction, 'test command'))) {
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'event') {
    const eventKey = interaction.options.getString('event', true);
    await eventReminders.sendTestReminder(interaction.guildId, eventKey);
    await replyEphemeral(interaction, `Sent test event reminder for \`${eventKey}\`.`);
    return;
  }

  if (subcommand === 'miningevent') {
    const eventKey = interaction.options.getString('event', true);
    try {
      await miningEvents.sendTestMiningEventPing(interaction.guildId, eventKey);
      await replyEphemeral(interaction, `Sent test mining event ping for \`${eventKey}\`.`);
    } catch (error) {
      await replyEphemeral(interaction, `Could not send test mining event ping: ${error.message}`);
    }
    return;
  }

  if (subcommand === 'weather') {
    const tier = interaction.options.getString('tier', true);
    try {
      await weather.sendTestWeatherPing(interaction.guildId, tier);
      await replyEphemeral(interaction, `Sent test weather ping for \`${tier}\`.`);
    } catch (error) {
      await replyEphemeral(interaction, `Could not send test weather ping: ${error.message}`);
    }
  }
}

const commandHandlers = {
  [commandNames.season]: (interaction) => harvestFeast.handleCommand(interaction),
  [commandNames.harvestfeast]: (interaction) => harvestFeast.handleCommand(interaction),
  [commandNames.help]: (interaction) => help.handleHelpCommand(interaction),
  [commandNames.setup]: (interaction) => setupHub.handleSetupCommand(interaction),
  [commandNames.simulate]: handleSimulateCommand,
  [commandNames.test]: handleTestCommand,
  [commandNames.reactionRole]: (interaction) => reactionRoles.handleReactionRoleCommand(interaction),
  [commandNames.cata]: (interaction) => catacombs.handleCatacombsCommand(interaction),
  [commandNames.catacombs]: (interaction) => catacombs.handleCatacombsCommand(interaction),
  [commandNames.itememoji]: (interaction) => itemEmoji.handleItemEmojiCommand(interaction),
  [commandNames.trophyfishing]: (interaction) => trophyFishing.handleTrophyFishingCommand(interaction),
  [commandNames.trophyfrogs]: (interaction) => trophyFishing.handleTrophyFrogsCommand(interaction),
  [commandNames.pest]: (interaction) => bestPest.handleBestPestCommand(interaction),
  [commandNames.pests]: (interaction) => bestPest.handleBestPestCommand(interaction),
  [commandNames.setfarmingstats]: (interaction) => pestFarmingProfit.handleSetFarmingStatsCommand(interaction),
  [commandNames.pestfarmingprofits]: (interaction) => pestFarmingProfit.handlePestFarmingProfitsCommand(interaction),
  [commandNames.lastpestfarmingprofits]: (interaction) => pestFarmingProfit.handleLastPestFarmingProfitsCommand(interaction),
  [commandNames.uuid]: (interaction) => playerUuid.handlePlayerUuidCommand(interaction),
  [commandNames.namehistory]: (interaction) => nameHistory.handleNameHistoryCommand(interaction),
  [commandNames.gif]: (interaction) => gif.handleGifCommand(interaction),
  [commandNames.hideonleaf]: (interaction) => hideonleaf.handleHideonleafCommand(interaction),
  [commandNames.shitter]: (interaction) => shitterList.handleShitterCommand(interaction),
  [commandNames.link]: (interaction) => linking.handleLinkCommand(interaction)
};

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === WEATHER_ISLAND_SELECT_ID) {
      await handleWeatherIslandSelect(interaction);
      return;
    }
    if (await reactionEditor.handle(interaction)) return;
    if (await pagedLists.handle(interaction)) return;
    if (await shitterList.handlePagination(interaction)) return;
    if (await modUpdates.handleViewAllReleasesButton(interaction)) return;
    if (await setupEditor.handle(interaction)) return;

    if (interaction.isAutocomplete() && interaction.commandName === commandNames.itememoji) {
      await itemEmoji.handleItemEmojiAutocomplete(interaction);
      return;
    }

    const commandHandler = interaction.isChatInputCommand() && Object.hasOwn(commandHandlers, interaction.commandName)
      ? commandHandlers[interaction.commandName]
      : null;
    if (commandHandler) {
      await commandHandler(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (await trophyFishing.handleTrophyFishSelect(interaction)) {
        return;
      }

      if (await trophyFishing.handleTrophyFrogSelect(interaction)) {
        return;
      }

      if (await mayorAlerts.handleCandidateSelect(interaction)) {
        return;
      }

      if (await shitterList.handleShitterPlayerSelect(interaction)) {
        return;
      }

      if (await shitterList.handleShitterEntrySelect(interaction)) {
        return;
      }
    }

    if (interaction.isButton() && (await catacombs.handleCatacombsViewButton(interaction))) {
      return;
    }

    // Overview and Player Tools; the other setup-view-* ids were handled by the editors above.
    if (interaction.isButton() && interaction.customId.startsWith('setup-view-')) {
      await setupHub.handleSetupNavigationButton(interaction);
    }
  } catch (error) {
    console.error('Interaction handling failed:', error);

    if (interaction.isRepliable()) {
      const replyPayload = { content: 'Something went wrong while handling that interaction.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(replyPayload).catch(() => {});
      } else {
        await interaction.reply(replyPayload).catch(() => {});
      }
    }
  }
});

void loginWithRetry().catch((error) => {
  console.error('Discord login failed permanently:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  void ircBridge.stop().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void ircBridge.stop().finally(() => process.exit(0));
});
