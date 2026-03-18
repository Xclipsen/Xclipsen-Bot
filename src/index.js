require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionsBitField,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const REQUIRED_ENV_VARS = [
  'DISCORD_TOKEN'
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || null;
const DEFAULT_DISCORD_ROLE_ID = process.env.DISCORD_ROLE_ID || null;
const PRIVILEGED_USER_IDS = new Set([
  '885542911511515146',
  ...String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
]);
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const CHECK_INTERVAL_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10)
);
const STATUS_UPDATE_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.STATUS_UPDATE_MINUTES || '30', 10)
);
const ELECTION_URL = 'https://api.hypixel.net/v2/resources/skyblock/election';
const SKYBLOCK_EPOCH_SECONDS = 1560275700;
const SKYBLOCK_DAY_SECONDS = 20 * 60;
const SKYBLOCK_YEAR_SECONDS = SKYBLOCK_DAY_SECONDS * 372;
const ELECTION_OPEN_START_DAY = 181;
const ELECTION_CLOSE_DAY = 88;
const CONFIG_FILE_PATH = path.join(__dirname, '..', 'data', 'config.json');
const STATE_FILE_PATH = path.join(__dirname, '..', 'data', 'state.json');
const MOCK_DATA_FILE_PATH = path.join(__dirname, '..', 'data', 'mock-election.json');
const SETUP_OPEN_MODAL_ID = 'setup-open-modal';
const SETUP_MODAL_ID = 'setup-modal';
const SETUP_CHANNEL_INPUT_ID = 'setup-channel-id';
const SETUP_ROLE_INPUT_ID = 'setup-role-id';
const SETUP_COMMAND = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Open the setup panel for this server.');
const SIMULATE_COMMAND = new SlashCommandBuilder()
  .setName('simulate')
  .setDescription('Simulate election states for testing.')
  .addStringOption((option) => option
    .setName('scenario')
    .setDescription('Scenario to apply')
    .setRequired(true)
    .addChoices(
      { name: 'booth-open', value: 'booth-open' },
      { name: 'booth-closed', value: 'booth-closed' },
       { name: 'mayor-diaz', value: 'mayor-diaz' },
       { name: 'mayor-paul', value: 'mayor-paul' },
       { name: 'clear', value: 'clear' }
     ));

const SIMULATION_SCENARIOS = {
  'booth-open': 'booth-open.json',
  'booth-closed': 'booth-closed.json',
  'mayor-diaz': 'mayor-diaz.json',
  'mayor-paul': 'mayor-paul.json'
};
const REACTION_ROLE_COMMAND = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('Configure reaction roles for a specific message.')
  .addSubcommand((subcommand) => subcommand
    .setName('add')
    .setDescription('Add a reaction role binding.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Channel containing the target message')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('message_id')
      .setDescription('Target message ID')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Role to assign when reacting')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('emoji')
      .setDescription('Emoji to watch, e.g. ✅ or <:diaz:123>')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('required_role')
      .setDescription('Optional role required before this reaction can grant the target role')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('remove')
    .setDescription('Remove a reaction role binding.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Channel containing the target message')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('message_id')
      .setDescription('Target message ID')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('emoji')
      .setDescription('Emoji to remove from the binding')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('List all configured reaction roles for this server.'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const MAYOR_HEADS = {
  aatrox: 'https://mc-heads.net/avatar/AatroxSB/256',
  cole: 'https://mc-heads.net/avatar/ColeSB/256',
  diana: 'https://mc-heads.net/avatar/DianaSB/256',
  diaz: 'https://mc-heads.net/avatar/DiazSB/256',
  finnegan: 'https://mc-heads.net/avatar/FinneganSB/256',
  foxy: 'https://mc-heads.net/avatar/FoxySB/256',
  marina: 'https://mc-heads.net/avatar/MarinaSB/256',
  paul: 'https://mc-heads.net/avatar/PaulSB/256',
  derpy: 'https://mc-heads.net/avatar/DerpySB/256',
  jerry: 'https://mc-heads.net/avatar/CandidateJerry/256',
  scorpius: 'https://mc-heads.net/avatar/ScorpiusSB/256'
};

const MAYOR_SKIN_LINKS = {
  aatrox: 'https://www.minecraftskins.com/skin/21660682/hypixel-skyblock-mayor-aatrox-npc/',
  cole: 'https://www.minecraftskins.com/skin/21660659/hypixel-skyblock-mayor-cole-npc/',
  diana: 'https://www.minecraftskins.com/skin/21660676/hypixel-skyblock-mayor-diana-npc/',
  diaz: 'https://www.minecraftskins.com/skin/21660663/hypixel-skyblock-mayor-diaz-npc/',
  finnegan: 'https://www.minecraftskins.com/skin/21719341/mayor-finnegan/',
  foxy: 'https://www.minecraftskins.com/skin/21660666/hypixel-skyblock-mayor-foxy-npc/',
  marina: 'https://www.minecraftskins.com/skin/21660684/hypixel-skyblock-mayor-marina-npc/',
  paul: 'https://www.minecraftskins.com/skin/21660667/hypixel-skyblock-mayor-paul-npc/',
  jerry: 'https://www.minecraftskins.com/skin/21660687/hypixel-skyblock-mayor-jerry-npc/',
  scorpius: 'https://www.minecraftskins.com/skin/21660693/hypixel-skyblock-mayor-scorpius-npc/',
  seraphine: 'https://www.minecraftskins.com/skin/21660694/hypixel-skyblock-mayor-seraphine-npc/'
};

const MAYOR_EMOJIS = {
  aatrox: process.env.EMOJI_AATROX || '⚔️',
  cole: process.env.EMOJI_COLE || '⛏️',
  diana: process.env.EMOJI_DIANA || '🏹',
  diaz: process.env.EMOJI_DIAZ || '💰',
  finnegan: process.env.EMOJI_FINNEGAN || '🌾',
  foxy: process.env.EMOJI_FOXY || '🎪',
  marina: process.env.EMOJI_MARINA || '🌊',
  paul: process.env.EMOJI_PAUL || '🗝️',
  derpy: process.env.EMOJI_DERPY || '🤪',
  jerry: process.env.EMOJI_JERRY || '🧨',
  scorpius: process.env.EMOJI_SCORPIUS || '🦂',
  seraphine: process.env.EMOJI_SERAPHINE || '🗳️'
};

const SKYBLOCK_MONTHS = [
  'Early Spring',
  'Spring',
  'Late Spring',
  'Early Summer',
  'Summer',
  'Late Summer',
  'Early Autumn',
  'Autumn',
  'Late Autumn',
  'Early Winter',
  'Winter',
  'Late Winter'
];

let lastMayorKey = null;
let initializedMayorState = false;
let guildConfig = loadConfig();
let guildState = loadState();
const resolvedMayorEmojiCache = new Map();

function loadJsonFile(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function saveJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadConfig() {
  const config = loadJsonFile(CONFIG_FILE_PATH, { guilds: {} });

  return {
    guilds: config.guilds && typeof config.guilds === 'object' ? config.guilds : {}
  };
}

function saveConfig() {
  saveJsonFile(CONFIG_FILE_PATH, guildConfig);
}

function loadState() {
  const state = loadJsonFile(STATE_FILE_PATH, null);

  if (!state) {
    return {
      guilds: {}
    };
  }

  if (state.guilds && typeof state.guilds === 'object') {
    return state;
  }

  return {
    guilds: {
      legacy: {
        boothOpen: state.boothOpen ?? null,
        alertMessageId: state.alertMessageId ?? null,
        alertChannelId: state.alertChannelId ?? null,
        statusMessageId: state.statusMessageId ?? null,
        statusChannelId: state.statusChannelId ?? null
      }
    }
  };
}

function saveState() {
  saveJsonFile(STATE_FILE_PATH, guildState);
}

function getGuildConfig(guildId) {
  return guildConfig.guilds[guildId] || {
    channelId: null,
    roleId: null,
    reactionRoles: []
  };
}

function normalizeGuildConfig(config) {
  return {
    channelId: config?.channelId || null,
    roleId: config?.roleId || null,
    reactionRoles: Array.isArray(config?.reactionRoles)
      ? config.reactionRoles.map((entry) => ({
        channelId: entry?.channelId || null,
        messageId: entry?.messageId || null,
        roleId: entry?.roleId || null,
        emoji: entry?.emoji || null,
        requiredRoleId: entry?.requiredRoleId || null
      }))
      : []
  };
}

function setGuildConfig(guildId, partialConfig) {
  guildConfig = {
    ...guildConfig,
    guilds: {
      ...guildConfig.guilds,
      [guildId]: {
        ...normalizeGuildConfig(getGuildConfig(guildId)),
        ...partialConfig
      }
    }
  };
  saveConfig();
}

function getGuildRuntimeState(guildId) {
  return guildState.guilds[guildId] || {
    boothOpen: null,
    alertMessageId: null,
    alertChannelId: null,
    statusMessageId: null,
    statusChannelId: null
  };
}

function getMockState() {
  return guildState.mock || {
    scenario: null,
    enabled: false
  };
}

function setGuildRuntimeState(guildId, partialState) {
  guildState = {
    ...guildState,
    guilds: {
      ...guildState.guilds,
      [guildId]: {
        ...getGuildRuntimeState(guildId),
        ...partialState
      }
    }
  };
  saveState();
}

function setMockState(partialState) {
  guildState = {
    ...guildState,
    mock: {
      ...getMockState(),
      ...partialState
    }
  };
  saveState();
}

function getReactionRoleEntries(guildId) {
  return normalizeGuildConfig(getGuildConfig(guildId)).reactionRoles;
}

function setReactionRoleEntries(guildId, reactionRoles) {
  setGuildConfig(guildId, { reactionRoles });
}

function getConfiguredGuildIds() {
  return Object.entries(guildConfig.guilds)
    .filter(([, config]) => config.channelId)
    .map(([guildId]) => guildId);
}

async function fetchElectionData() {
  const mockState = getMockState();

  if (mockState.enabled && mockState.scenario) {
    return loadMockElectionData(path.join(path.dirname(MOCK_DATA_FILE_PATH), 'mock-scenarios', mockState.scenario));
  }

  if (MOCK_MODE) {
    return loadMockElectionData(MOCK_DATA_FILE_PATH);
  }

  const response = await fetch(ELECTION_URL, {
    headers: {
      'User-Agent': 'hypixel-mayor-discord-bot/1.0.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Hypixel API responded with ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.success || !data.mayor) {
    throw new Error('Hypixel API response did not contain mayor data.');
  }

  return data;
}

function loadMockElectionData(filePath) {
  const data = loadJsonFile(filePath, null);

  if (!data || !data.success || !data.mayor) {
    throw new Error(`Mock election data is invalid: ${filePath}`);
  }

  return data;
}

function getBoothOpen(data) {
  if (typeof data?._mock?.boothOpen === 'boolean') {
    return data._mock.boothOpen;
  }

  return getElectionSchedule().boothOpen;
}

async function getTargetChannel(guildId) {
  const { channelId } = getGuildConfig(guildId);

  if (!channelId) {
    throw new Error(`Guild ${guildId} does not have a configured target channel.`);
  }

  const channel = await client.channels.fetch(channelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Configured Discord channel is not a text channel.');
  }

  return channel;
}

async function getStoredStatusMessage(guildId, channel) {
  return getStoredMessage(guildId, channel, {
    idKey: 'statusMessageId',
    channelKey: 'statusChannelId',
    resetState: {
      statusMessageId: null,
      statusChannelId: null
    }
  });
}

function isStatusUpdateMessage(message) {
  if (!message || message.author?.id !== client.user?.id) {
    return false;
  }

  if (typeof message.content === 'string' && message.content.includes('Current SkyBlock mayor update.')) {
    return true;
  }

  return message.embeds.some((embed) => embed.title?.includes('SkyBlock Status Update'));
}

async function findExistingStatusMessage(guildId, channel) {
  const storedMessage = await getStoredStatusMessage(guildId, channel);

  if (storedMessage) {
    return storedMessage;
  }

  const recentMessages = await channel.messages.fetch({ limit: 25 });
  const statusMessages = recentMessages
    .filter((message) => isStatusUpdateMessage(message))
    .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

  if (statusMessages.size === 0) {
    return null;
  }

  const [latestMessage, ...olderMessages] = [...statusMessages.values()];

  await Promise.all(
    olderMessages.map((message) => message.delete().catch(() => null))
  );

  setGuildRuntimeState(guildId, {
    statusMessageId: latestMessage.id,
    statusChannelId: latestMessage.channelId
  });

  return latestMessage;
}

async function getStoredAlertMessage(guildId, channel) {
  return getStoredMessage(guildId, channel, {
    idKey: 'alertMessageId',
    channelKey: 'alertChannelId',
    resetState: {
      alertMessageId: null,
      alertChannelId: null
    }
  });
}

async function getStoredMessage(guildId, channel, { idKey, channelKey, resetState }) {
  const state = getGuildRuntimeState(guildId);

  if (!state[idKey]) {
    return null;
  }

  if (state[channelKey] && state[channelKey] !== channel.id) {
    return null;
  }

  try {
    return await channel.messages.fetch(state[idKey]);
  } catch {
    setGuildRuntimeState(guildId, resetState);
    return null;
  }
}

async function replaceAlertMessage(guildId, payload) {
  const channel = await getTargetChannel(guildId);
  const existingMessage = await getStoredAlertMessage(guildId, channel);

  if (existingMessage) {
    await existingMessage.delete().catch(() => null);
  }

  const sentMessage = await channel.send(payload);
  setGuildRuntimeState(guildId, {
    alertMessageId: sentMessage.id,
    alertChannelId: sentMessage.channelId
  });

  return sentMessage;
}

function createSetupEmbed(guild, note = null) {
  const config = getGuildConfig(guild.id);
  const tokenState = DISCORD_TOKEN ? 'Loaded from environment' : 'Missing';
  const descriptionLines = [
    'Use the button below to open the setup form.',
    'Enter the target channel ID and role ID for this server.',
    'The bot token stays in `.env` or your container environment and is not changed from Discord.'
  ];

  if (note) {
    descriptionLines.push('', note);
  }

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Bot Setup')
    .setDescription(descriptionLines.join('\n'))
    .addFields(
      {
        name: 'Token',
        value: tokenState,
        inline: false
      },
      {
        name: 'Channel',
        value: config.channelId ? `<#${config.channelId}>` : 'Not configured',
        inline: true
      },
      {
        name: 'Role',
        value: config.roleId ? `<@&${config.roleId}>` : 'Not configured',
        inline: true
      }
    )
    .setFooter({ text: 'Requires Manage Server or privileged bot access.' });
}

function createSetupComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(SETUP_OPEN_MODAL_ID)
        .setLabel('Open Setup Form')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function hasManageGuildPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) === true;
}

function isPrivilegedUser(interaction) {
  return PRIVILEGED_USER_IDS.has(String(interaction.user?.id || ''));
}

async function ensureSetupAccess(interaction, sourceLabel) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: `This ${sourceLabel} can only be used inside a server.`,
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  if (!hasManageGuildPermission(interaction) && !isPrivilegedUser(interaction)) {
    await interaction.reply({
      content: 'You need the Manage Server permission or privileged bot access to configure this bot.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  return true;
}

async function handleSetupCommand(interaction) {
  if (!(await ensureSetupAccess(interaction, 'command'))) {
    return;
  }

  await interaction.reply({
    embeds: [createSetupEmbed(interaction.guild)],
    components: createSetupComponents(),
    flags: MessageFlags.Ephemeral
  });
}

async function handleSimulateCommand(interaction) {
  if (!(await ensureSetupAccess(interaction, 'simulate command'))) {
    return;
  }

  const scenario = interaction.options.getString('scenario', true);

  if (scenario === 'clear') {
    setMockState({ enabled: false, scenario: null });
    await interaction.reply({
      content: 'Simulation cleared. The bot will use the real Hypixel API again.',
      flags: MessageFlags.Ephemeral
    });
    await checkElectionState();
    await sendScheduledStatusUpdate();
    return;
  }

  const scenarioFile = SIMULATION_SCENARIOS[scenario];
  if (!scenarioFile) {
    await interaction.reply({
      content: 'Unknown simulation scenario.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  setMockState({ enabled: true, scenario: scenarioFile });

  await interaction.reply({
    content: `Simulation scenario set to \`${scenario}\`. Triggering a fresh check now.`,
    flags: MessageFlags.Ephemeral
  });

  await checkElectionState();
  await sendScheduledStatusUpdate();
}

function buildReactionRoleSummary(guildId) {
  const reactionRoles = getReactionRoleEntries(guildId);

  if (reactionRoles.length === 0) {
    return 'No reaction roles configured yet.';
  }

  return reactionRoles
    .map((entry, index) => {
      const restriction = entry.requiredRoleId
        ? ` (requires <@&${entry.requiredRoleId}>)`
        : '';

      return `${index + 1}. ${entry.emoji} -> <@&${entry.roleId}> on ${entry.channelId}/${entry.messageId}${restriction}`;
    })
    .join('\n');
}

async function handleReactionRoleCommand(interaction) {
  if (!(await ensureSetupAccess(interaction, 'reaction role command'))) {
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'list') {
    await interaction.reply({
      content: buildReactionRoleSummary(interaction.guildId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const messageId = interaction.options.getString('message_id', true).trim();
  const emojiInput = interaction.options.getString('emoji', true);
  const emoji = normalizeEmojiIdentifier(emojiInput);

  if (!channel.isTextBased()) {
    await interaction.reply({
      content: 'The selected channel must be text-based.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!isSnowflake(messageId)) {
    await interaction.reply({
      content: 'Message ID must be a valid Discord snowflake.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetMessage = await fetchGuildMessage(channel, messageId).catch((error) => error);
  if (targetMessage instanceof Error) {
    await interaction.reply({
      content: targetMessage.message,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existingEntries = getReactionRoleEntries(interaction.guildId);

  if (subcommand === 'add') {
    const role = interaction.options.getRole('role', true);
    const requiredRole = interaction.options.getRole('required_role');
    const duplicate = existingEntries.find((entry) => (
      entry.channelId === channel.id &&
      entry.messageId === messageId &&
      entry.emoji === emoji
    ));

    if (duplicate) {
      await interaction.reply({
        content: 'That reaction role binding already exists for this message and emoji.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await targetMessage.react(emojiInput).catch(() => null);
    setReactionRoleEntries(interaction.guildId, [
      ...existingEntries,
        {
          channelId: channel.id,
          messageId,
          roleId: role.id,
          emoji,
          requiredRoleId: requiredRole?.id || null
        }
      ]);

      await interaction.reply({
      content: requiredRole
        ? `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${targetMessage.url}) and requires <@&${requiredRole.id}>.`
        : `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${targetMessage.url}).`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const nextEntries = existingEntries.filter((entry) => !(
    entry.channelId === channel.id &&
    entry.messageId === messageId &&
    entry.emoji === emoji
  ));

  if (nextEntries.length === existingEntries.length) {
    await interaction.reply({
      content: 'No matching reaction role binding was found to remove.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  setReactionRoleEntries(interaction.guildId, nextEntries);
  await targetMessage.reactions.resolve(emoji)?.remove().catch(() => null);
  await interaction.reply({
    content: `Removed reaction role binding for ${emojiInput} on [this message](${targetMessage.url}).`,
    flags: MessageFlags.Ephemeral
  });
}

function createSetupModal(existingConfig) {
  return new ModalBuilder()
    .setCustomId(SETUP_MODAL_ID)
    .setTitle('Bot Setup')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SETUP_CHANNEL_INPUT_ID)
          .setLabel('Channel ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(existingConfig.channelId || '')
          .setPlaceholder('1093242679493664768')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SETUP_ROLE_INPUT_ID)
          .setLabel('Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(existingConfig.roleId || '')
          .setPlaceholder('1483819173447733419')
      )
    );
}

function isSnowflake(value) {
  return /^\d{16,20}$/.test(String(value || '').trim());
}

function normalizeEmojiIdentifier(value) {
  const raw = String(value || '').trim();
  const customEmojiMatch = raw.match(/^<a?:[^:]+:(\d+)>$/);

  if (customEmojiMatch) {
    return customEmojiMatch[1];
  }

  return raw;
}

function getReactionEmojiIdentifier(reaction) {
  return reaction.emoji.id || reaction.emoji.name || null;
}

async function fetchGuildMessage(channel, messageId) {
  const message = await channel.messages.fetch(messageId).catch(() => null);

  if (!message) {
    throw new Error('The message ID is invalid or not found in that channel.');
  }

  return message;
}

async function handleSetupButton(interaction) {
  if (!(await ensureSetupAccess(interaction, 'setup button'))) {
    return;
  }

  await interaction.showModal(createSetupModal(getGuildConfig(interaction.guildId)));
}

async function handleSetupModalSubmit(interaction) {
  if (!(await ensureSetupAccess(interaction, 'setup form'))) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelId = interaction.fields.getTextInputValue(SETUP_CHANNEL_INPUT_ID).trim();
  const roleId = interaction.fields.getTextInputValue(SETUP_ROLE_INPUT_ID).trim();

  if (!isSnowflake(channelId) || !isSnowflake(roleId)) {
    await interaction.editReply({
      content: 'Channel ID and Role ID must be valid Discord snowflakes.',
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: 'The channel ID is invalid or not a text-based channel in this server.',
    });
    return;
  }

  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.editReply({
      content: 'The role ID is invalid or not part of this server.',
    });
    return;
  }

  setGuildConfig(interaction.guildId, {
    channelId,
    roleId
  });
  setGuildRuntimeState(interaction.guildId, {
    statusMessageId: null,
    statusChannelId: null
  });

  let setupNote = 'Setup saved successfully.';

  try {
    const data = await fetchElectionData();
    const mayor = data.mayor;
    const boothOpen = getBoothOpen(data);

    await sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen);
    setGuildRuntimeState(interaction.guildId, {
      ...getGuildRuntimeState(interaction.guildId),
      boothOpen
    });
    setupNote = `Setup saved successfully. Posted the current mayor status for ${mayor.name}.`;
  } catch (error) {
    console.error(`Failed to send immediate status update for guild ${interaction.guildId}:`, error);
    setupNote = 'Setup saved successfully, but the current mayor status could not be posted yet.';
  }

  await interaction.editReply({
    embeds: [createSetupEmbed(interaction.guild, setupNote)],
    components: createSetupComponents(),
  });
}

async function registerGuildCommands(guild) {
  console.log(`Registering commands for guild ${guild.id} (${guild.name})`);
  await guild.commands.set([
    SETUP_COMMAND.toJSON(),
    SIMULATE_COMMAND.toJSON(),
    REACTION_ROLE_COMMAND.toJSON()
  ]);
  console.log(`Registered commands for guild ${guild.id} (${guild.name})`);
}

async function resolveReactionContext(reaction) {
  if (reaction.partial) {
    await reaction.fetch();
  }

  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  return reaction.message;
}

async function applyReactionRoleChange(reaction, user, shouldAdd) {
  if (user.bot) {
    return;
  }

  const message = await resolveReactionContext(reaction).catch(() => null);
  if (!message?.guildId) {
    return;
  }

  const emoji = getReactionEmojiIdentifier(reaction);
  if (!emoji) {
    return;
  }

  const reactionRole = getReactionRoleEntries(message.guildId).find((entry) => (
    entry.channelId === message.channelId &&
    entry.messageId === message.id &&
    entry.emoji === emoji
  ));

  if (!reactionRole) {
    return;
  }

  const guild = message.guild || await client.guilds.fetch(message.guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return;
  }

  if (shouldAdd && reactionRole.requiredRoleId && !member.roles.cache.has(reactionRole.requiredRoleId)) {
    await reaction.users.remove(user.id).catch((error) => {
      console.error(
        `Failed to remove unauthorized reaction ${reactionRole.emoji} from ${user.id} in guild ${guild.id}:`,
        error
      );
    });
    return;
  }

  if (shouldAdd) {
    await member.roles.add(reactionRole.roleId).catch((error) => {
      console.error(`Failed to add role ${reactionRole.roleId} to ${user.id}:`, error);
    });
    return;
  }

  await member.roles.remove(reactionRole.roleId).catch((error) => {
    console.error(`Failed to remove role ${reactionRole.roleId} from ${user.id}:`, error);
  });
}

async function ensureLegacyEnvConfig() {
  if (!DEFAULT_DISCORD_CHANNEL_ID) {
    return;
  }

  try {
    const channel = await client.channels.fetch(DEFAULT_DISCORD_CHANNEL_ID);

    if (!channel || !('guildId' in channel) || !channel.guildId) {
      return;
    }

    const existingConfig = getGuildConfig(channel.guildId);
    setGuildConfig(channel.guildId, {
      channelId: existingConfig.channelId || DEFAULT_DISCORD_CHANNEL_ID,
      roleId: existingConfig.roleId || DEFAULT_DISCORD_ROLE_ID
    });
  } catch (error) {
    console.error('Could not import legacy env configuration:', error);
  }
}

function formatMayorPerks(mayor) {
  const perks = Array.isArray(mayor.perks) ? mayor.perks : [];

  if (!perks.length) {
    return '- No perks found';
  }

  return perks
    .map((perk) => `- **${perk.name}**: ${stripMinecraftFormatting(perk.description)}`)
    .join('\n');
}

function stripMinecraftFormatting(text) {
  return String(text || '').replace(/§./g, '');
}

function toDiscordTimestamp(timestamp, style = 'f') {
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function getOrdinal(value) {
  const remainder = value % 100;

  if (remainder >= 11 && remainder <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function getSkyBlockDateParts(now = Date.now()) {
  const skyblockOffsetMs = now - (SKYBLOCK_EPOCH_SECONDS * 1000);
  const skyblockYear = Math.floor(skyblockOffsetMs / 446400000) + 1;
  const skyblockMonthIndex = Math.floor(skyblockOffsetMs / 37200000) % 12;
  const skyblockDay = (Math.floor(skyblockOffsetMs / 1200000) % 31) + 1;
  const skyblockHour = ((Math.floor(skyblockOffsetMs / 50000) % 24) + 24) % 24;
  const skyblockMinute = ((Math.floor((6 * skyblockOffsetMs) / 50000) % 60) + 60) % 60;

  return {
    year: skyblockYear,
    month: SKYBLOCK_MONTHS[(skyblockMonthIndex + 12) % 12],
    day: skyblockDay,
    hour: skyblockHour,
    minute: skyblockMinute
  };
}

function formatSkyBlockTime(hour, minute) {
  const suffix = hour >= 12 ? 'pm' : 'am';
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, '0')}${suffix}`;
}

function formatSkyBlockDate(maxAgeMinutes) {
  const skyblockDate = getSkyBlockDateParts();
  const baseDate = `${getOrdinal(skyblockDate.day)} of ${skyblockDate.month}, Year ${skyblockDate.year}`;

  if (maxAgeMinutes <= 120) {
    return `${baseDate} - ${formatSkyBlockTime(skyblockDate.hour, skyblockDate.minute)}`;
  }

  if (maxAgeMinutes <= 720) {
    return baseDate;
  }

  return `${skyblockDate.month}, Year ${skyblockDate.year}`;
}

function getElectionSchedule(now = Date.now()) {
  const unixSeconds = now / 1000;
  const secondsSinceEpoch = unixSeconds - SKYBLOCK_EPOCH_SECONDS;
  const yearPositionSeconds = ((secondsSinceEpoch % SKYBLOCK_YEAR_SECONDS) + SKYBLOCK_YEAR_SECONDS) % SKYBLOCK_YEAR_SECONDS;
  const openStartSeconds = ELECTION_OPEN_START_DAY * SKYBLOCK_DAY_SECONDS;
  const closeSeconds = ELECTION_CLOSE_DAY * SKYBLOCK_DAY_SECONDS;
  const boothOpen = yearPositionSeconds >= openStartSeconds || yearPositionSeconds < closeSeconds;

  let nextTransitionSeconds;

  if (boothOpen) {
    nextTransitionSeconds = yearPositionSeconds < closeSeconds
      ? closeSeconds
      : SKYBLOCK_YEAR_SECONDS + closeSeconds;
  } else {
    nextTransitionSeconds = openStartSeconds;
  }

  const secondsUntilTransition = nextTransitionSeconds - yearPositionSeconds;

  return {
    boothOpen,
    nextTransitionAt: now + (secondsUntilTransition * 1000)
  };
}

function getElectionTimingLine(isOpen) {
  const schedule = getElectionSchedule();
  const targetTimestamp = schedule.nextTransitionAt;

  if (isOpen) {
    return `Election ends: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`;
  }

  return `Next election opens: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`;
}

function compactMayorPerks(mayor) {
  const perks = Array.isArray(mayor.perks) ? mayor.perks : [];

  if (!perks.length) {
    return 'No perks found';
  }

  return perks.map((perk) => stripMinecraftFormatting(perk.name)).join(' | ');
}

async function sendRolePing(guildId, content, embeds = []) {
  const { roleId } = getGuildConfig(guildId);

  if (!roleId) {
    throw new Error(`Guild ${guildId} does not have a configured ping role.`);
  }

  await replaceAlertMessage(guildId, {
    content: [`<@&${roleId}>`, content].join('\n'),
    embeds,
    allowedMentions: {
      roles: [roleId]
    }
  });
}

function getMayorHeadUrl(mayor) {
  return MAYOR_HEADS[String(mayor.key || '').toLowerCase()] || null;
}

function getMayorSkinLink(mayor) {
  return MAYOR_SKIN_LINKS[String(mayor.key || '').toLowerCase()] || null;
}

async function getMayorEmoji(guildId, mayor) {
  const mayorKey = String(mayor.key || '').toLowerCase();
  const mayorName = String(mayor.name || '').toLowerCase();
  const lookupKeys = [mayorName, mayorKey].filter(Boolean);

  for (const lookupKey of lookupKeys) {
    const cacheKey = `${guildId}:${lookupKey}`;
    if (resolvedMayorEmojiCache.has(cacheKey)) {
      return resolvedMayorEmojiCache.get(cacheKey);
    }
  }

  const configuredEmoji = MAYOR_EMOJIS[mayorName] || MAYOR_EMOJIS[mayorKey];
  if (configuredEmoji && configuredEmoji.startsWith('<')) {
    for (const lookupKey of lookupKeys) {
      resolvedMayorEmojiCache.set(`${guildId}:${lookupKey}`, configuredEmoji);
    }
    return configuredEmoji;
  }

  try {
    const channel = await getTargetChannel(guildId);
    if ('guild' in channel && channel.guild) {
      await channel.guild.emojis.fetch();

      const matchingEmoji = channel.guild.emojis.cache.find((emoji) => {
        const normalizedName = String(emoji.name || '').toLowerCase();
        return lookupKeys.some((lookupKey) => (
          normalizedName === lookupKey ||
          normalizedName === `mayor_${lookupKey}` ||
          normalizedName === `mayor${lookupKey}`
        ));
      });

      if (matchingEmoji) {
        const formattedEmoji = matchingEmoji.toString();
        for (const lookupKey of lookupKeys) {
          resolvedMayorEmojiCache.set(`${guildId}:${lookupKey}`, formattedEmoji);
        }
        return formattedEmoji;
      }

      console.log(
        `No custom emoji found for ${lookupKeys.join(', ')}; checked ${channel.guild.emojis.cache.size} guild emojis`
      );
    }
  } catch (error) {
    console.error(`Could not resolve custom emoji for ${lookupKeys.join(', ')}:`, error);
  }

  return configuredEmoji || '👤';
}

function createMayorEmbed(title, emoji, mayor, boothOpen) {
  const skyBlockDate = formatSkyBlockDate(title === 'SkyBlock Status Update' ? STATUS_UPDATE_MINUTES : CHECK_INTERVAL_MINUTES);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${emoji} ${title}`)
    .addFields(
      {
        name: 'Mayor',
        value: `${mayor.name} (${mayor.key})`,
        inline: true
      },
      {
        name: 'Election Booth',
        value: boothOpen === true ? 'Open' : 'Closed',
        inline: true
      },
      {
        name: boothOpen === true ? 'Election Ends' : 'Next Election Opens',
        value: getElectionTimingLine(boothOpen === true),
        inline: false
      },
      {
        name: 'Active Perks',
        value: compactMayorPerks(mayor),
        inline: false
      },
      {
        name: 'Perk Details',
        value: formatMayorPerks(mayor),
        inline: false
      }
    )
    .setFooter({ text: `SkyBlock Date: ${skyBlockDate}` })
    .setTimestamp();

  if (mayor.minister) {
    embed.addFields({
      name: 'Minister',
      value: `${mayor.minister.name} - ${stripMinecraftFormatting(mayor.minister.perk.name)}`,
      inline: false
    });
  }

  const skinLink = getMayorSkinLink(mayor);
  if (skinLink) {
    embed.addFields({
      name: 'Skin',
      value: `[View mayor skin](${skinLink})`,
      inline: false
    });
  }

  const headUrl = getMayorHeadUrl(mayor);
  if (headUrl) {
    embed.setThumbnail(headUrl);
  }

  return embed;
}

async function sendMayorChangePing(guildId, mayor, boothOpen) {
  const mayorEmoji = await getMayorEmoji(guildId, mayor);
  await sendRolePing(
    guildId,
    `${mayorEmoji} A new mayor has been elected.`,
    [createMayorEmbed('New SkyBlock Mayor', mayorEmoji, mayor, boothOpen)]
  );
}

async function sendElectionPing(guildId, currentElection) {
  const candidateNames = Array.isArray(currentElection.candidates)
    ? currentElection.candidates.map((candidate) => candidate.name).join(', ')
    : 'Unknown candidates';

  await sendRolePing(
    guildId,
    [
      ':ballot_box: **Election Booth Open**',
      `Candidates: **${candidateNames}**`,
      getElectionTimingLine(true)
    ].join('\n')
  );
}

async function sendElectionClosedPing(guildId) {
  await sendRolePing(
    guildId,
    [
      ':lock: **Election Booth Closed**',
      getElectionTimingLine(false)
    ].join('\n')
  );
}

async function sendMayorStatusUpdate(guildId, mayor, boothOpen) {
  const channel = await getTargetChannel(guildId);
  const mayorEmoji = await getMayorEmoji(guildId, mayor);
  const payload = {
    content: `${mayorEmoji} Current SkyBlock mayor update.`,
    embeds: [createMayorEmbed('SkyBlock Status Update', mayorEmoji, mayor, boothOpen)]
  };
  const existingMessage = await findExistingStatusMessage(guildId, channel);

  if (existingMessage) {
    await existingMessage.edit(payload);
    return;
  }

  const sentMessage = await channel.send(payload);
  setGuildRuntimeState(guildId, {
    statusMessageId: sentMessage.id,
    statusChannelId: sentMessage.channelId
  });
}

async function checkElectionState() {
  try {
    const data = await fetchElectionData();
    const mayor = data.mayor;
    const currentElection = data.current || null;
    const currentMayorKey = String(mayor.key || '').toLowerCase();
    const boothOpen = getBoothOpen(data);
    const configuredGuildIds = getConfiguredGuildIds();

    for (const guildId of configuredGuildIds) {
      const state = getGuildRuntimeState(guildId);

      if (state.boothOpen !== boothOpen) {
        setGuildRuntimeState(guildId, {
          ...state,
          boothOpen
        });

        if (boothOpen && currentElection && getGuildConfig(guildId).roleId) {
          console.log(`Election booth is now open for guild ${guildId}`);
          await sendElectionPing(guildId, currentElection);
        }

        if (!boothOpen && getGuildConfig(guildId).roleId) {
          console.log(`Election booth is now closed for guild ${guildId}`);
          await sendElectionClosedPing(guildId);
        }
      }
    }

    if (!initializedMayorState) {
      initializedMayorState = true;
      lastMayorKey = currentMayorKey;
      console.log(`Initial mayor state set to ${mayor.name} (${currentMayorKey})`);
      return;
    }

    if (currentMayorKey !== lastMayorKey) {
      lastMayorKey = currentMayorKey;
      console.log(`Current mayor changed to ${mayor.name} (${currentMayorKey})`);

      for (const guildId of configuredGuildIds) {
        if (!getGuildConfig(guildId).roleId) {
          continue;
        }

        await sendMayorChangePing(guildId, mayor, boothOpen);
      }
    }
  } catch (error) {
    console.error('Election state check failed:', error);
  }
}

async function sendScheduledStatusUpdate() {
  try {
    const data = await fetchElectionData();
    const mayor = data.mayor;
    const boothOpen = getBoothOpen(data);

    for (const guildId of getConfiguredGuildIds()) {
      await sendMayorStatusUpdate(guildId, mayor, boothOpen);
      setGuildRuntimeState(guildId, {
        ...getGuildRuntimeState(guildId),
        boothOpen
      });
      console.log(`Status update sent for mayor ${mayor.name} in guild ${guildId}`);
    }
  } catch (error) {
    console.error('Status update failed:', error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Connected guilds: ${readyClient.guilds.cache.map((guild) => `${guild.id} (${guild.name})`).join(', ')}`);
  await ensureLegacyEnvConfig();

  for (const guild of readyClient.guilds.cache.values()) {
    await registerGuildCommands(guild);
  }

  await checkElectionState();
  await sendScheduledStatusUpdate();
  setInterval(checkElectionState, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(sendScheduledStatusUpdate, STATUS_UPDATE_MINUTES * 60 * 1000);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined guild ${guild.id} (${guild.name})`);
  await registerGuildCommands(guild);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await applyReactionRoleChange(reaction, user, true);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await applyReactionRoleChange(reaction, user, false);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === 'setup'
    ) {
      await handleSetupCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'simulate') {
      await handleSimulateCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'reactionrole') {
      await handleReactionRoleCommand(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === SETUP_OPEN_MODAL_ID) {
      await handleSetupButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === SETUP_MODAL_ID) {
      await handleSetupModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Interaction handling failed:', error);

    if (interaction.isRepliable()) {
      const replyPayload = {
        content: 'Something went wrong while handling that interaction.',
        flags: MessageFlags.Ephemeral
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(replyPayload).catch(() => {});
      } else {
        await interaction.reply(replyPayload).catch(() => {});
      }
    }
  }
});

client.login(DISCORD_TOKEN);
