const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { env } = require('./config/env');
const { commands, commandNames } = require('./config/commands');
const { interactionIds } = require('./config/interactionIds');
const { createStore } = require('./storage/store');
const { createAccessControl } = require('./features/accessControl');
const { createSkyblockUtils } = require('./utils/skyblock');
const { createMinecraftUtils } = require('./utils/minecraft');
const { createMayorAlerts } = require('./features/mayorAlerts');
const { createReactionRoleService } = require('./features/reactionRoles');
const { createSetupHub } = require('./features/setupHub');
const { createCatacombsFeature } = require('./features/catacombs');
const { createNameHistoryFeature } = require('./features/nameHistory');
const { createPlayerUuidFeature } = require('./features/playerUuid');
const { createShitterListFeature } = require('./features/shitterList');
const { createSimulationFeature } = require('./features/simulation');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const store = createStore({
  configFilePath: env.CONFIG_FILE_PATH,
  shitterFilePath: env.SHITTER_FILE_PATH,
  stateFilePath: env.STATE_FILE_PATH
});

const accessControl = createAccessControl(env.PRIVILEGED_USER_IDS);
const skyblock = createSkyblockUtils(env);
const minecraft = createMinecraftUtils();
const mayorAlerts = createMayorAlerts({ client, env, store, skyblock });
const reactionRoles = createReactionRoleService({
  client,
  store,
  ensureSetupAccess: accessControl.ensureSetupAccess
});
const setupHub = createSetupHub({
  store,
  ensureSetupAccess: accessControl.ensureSetupAccess,
  mayorAlerts,
  reactionRoles,
  interactionIds
});
const catacombs = createCatacombsFeature({ env, minecraft });
const nameHistory = createNameHistoryFeature({ minecraft });
const playerUuid = createPlayerUuidFeature({ minecraft });
const shitterList = createShitterListFeature({
  store,
  ensureSetupAccess: accessControl.ensureSetupAccess
});
const simulation = createSimulationFeature({ store });

async function registerGuildCommands(guild) {
  console.log(`Registering commands for guild ${guild.id} (${guild.name})`);
  await guild.commands.set(commands.map((command) => command.toJSON()));
  console.log(`Registered commands for guild ${guild.id} (${guild.name})`);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Connected guilds: ${readyClient.guilds.cache.map((guild) => `${guild.id} (${guild.name})`).join(', ')}`);

  await mayorAlerts.ensureLegacyEnvConfig();

  for (const guild of readyClient.guilds.cache.values()) {
    await registerGuildCommands(guild);
  }

  await mayorAlerts.checkElectionState();
  await mayorAlerts.sendScheduledStatusUpdate();
  setInterval(() => void mayorAlerts.checkElectionState(), env.CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(() => void mayorAlerts.sendScheduledStatusUpdate(), env.STATUS_UPDATE_MINUTES * 60 * 1000);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined guild ${guild.id} (${guild.name})`);
  await registerGuildCommands(guild);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await reactionRoles.applyReactionRoleChange(reaction, user, true);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await reactionRoles.applyReactionRoleChange(reaction, user, false);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.setup) {
      await setupHub.handleSetupCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.simulate) {
      if (!(await accessControl.ensureSetupAccess(interaction, 'simulate command'))) {
        return;
      }

      await simulation.handleSimulateCommand(interaction, mayorAlerts);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.reactionRole) {
      await reactionRoles.handleReactionRoleCommand(interaction);
      return;
    }

    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === commandNames.cata || interaction.commandName === commandNames.catacombs)
    ) {
      await catacombs.handleCatacombsCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.uuid) {
      await playerUuid.handlePlayerUuidCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.namehistory) {
      await nameHistory.handleNameHistoryCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === commandNames.shitter) {
      await shitterList.handleShitterCommand(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
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

    if (interaction.isButton() && interaction.customId.startsWith('setup-view-')) {
      await setupHub.handleSetupNavigationButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === interactionIds.SETUP_MAYOR_RELOAD_ID) {
      await setupHub.handleSetupNavigationButton(interaction);
      return;
    }

    if (
      interaction.isButton() &&
      (
        interaction.customId === interactionIds.SETUP_REACTION_ADD_MODAL_ID ||
        interaction.customId === interactionIds.SETUP_REACTION_REMOVE_MODAL_ID ||
        interaction.customId === interactionIds.SETUP_MAYOR_EDIT_ID ||
        interaction.customId === interactionIds.SETUP_MAYOR_TOGGLE_ELECTION_PING_ID ||
        interaction.customId === interactionIds.SETUP_MAYOR_TOGGLE_CHANGE_PING_ID ||
        interaction.customId === interactionIds.SETUP_MAYOR_RESET_ID ||
        interaction.customId === interactionIds.SETUP_SHITTER_MODAL_ID
      )
    ) {
      await setupHub.handleSetupActionButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === interactionIds.SETUP_MODAL_ID) {
      await setupHub.handleMayorSetupModalSubmit(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === interactionIds.SETUP_REACTION_ADD_MODAL_ID) {
      await setupHub.handleReactionRoleModalSubmit(interaction, 'add');
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === interactionIds.SETUP_REACTION_REMOVE_MODAL_ID) {
      await setupHub.handleReactionRoleModalSubmit(interaction, 'remove');
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === interactionIds.SETUP_SHITTER_MODAL_ID) {
      await setupHub.handleShitterSetupModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Interaction handling failed:', error);

    if (interaction.isRepliable()) {
      const replyPayload = { content: 'Something went wrong while handling that interaction.', flags: 64 };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(replyPayload).catch(() => {});
      } else {
        await interaction.reply(replyPayload).catch(() => {});
      }
    }
  }
});

client.login(env.DISCORD_TOKEN);
