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
const SKYBLOCK_YEAR_DAYS = 372;
const SKYBLOCK_YEAR_SECONDS = SKYBLOCK_DAY_SECONDS * SKYBLOCK_YEAR_DAYS;
const ELECTION_OPEN_START_DAY = 181;
const ELECTION_CLOSE_DAY = 88;
const CONFIG_FILE_PATH = path.join(__dirname, '..', 'data', 'config.json');
const STATE_FILE_PATH = path.join(__dirname, '..', 'data', 'state.json');
const SETUP_OPEN_MODAL_ID = 'setup-open-modal';
const SETUP_MODAL_ID = 'setup-modal';
const SETUP_TOKEN_INPUT_ID = 'setup-token';
const SETUP_CHANNEL_INPUT_ID = 'setup-channel-id';
const SETUP_ROLE_INPUT_ID = 'setup-role-id';
const CONFIG_COMMAND = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure the bot channel and role for this server.')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);
const SETUP_COMMAND = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Open the setup panel for this server.')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
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

let lastMayorKey = null;
let lastElectionId = null;
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
    roleId: null
  };
}

function setGuildConfig(guildId, partialConfig) {
  guildConfig = {
    ...guildConfig,
    guilds: {
      ...guildConfig.guilds,
      [guildId]: {
        ...getGuildConfig(guildId),
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

function getConfiguredGuildIds() {
  return Object.entries(guildConfig.guilds)
    .filter(([, config]) => config.channelId)
    .map(([guildId]) => guildId);
}

async function fetchElectionData() {
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
  const state = getGuildRuntimeState(guildId);

  if (!state.statusMessageId) {
    return null;
  }

  if (state.statusChannelId && state.statusChannelId !== channel.id) {
    return null;
  }

  try {
    return await channel.messages.fetch(state.statusMessageId);
  } catch {
    setGuildRuntimeState(guildId, {
      alertMessageId: null,
      alertChannelId: null,
      statusMessageId: null,
      statusChannelId: null
    });
    return null;
  }
}

async function getStoredAlertMessage(guildId, channel) {
  const state = getGuildRuntimeState(guildId);

  if (!state.alertMessageId) {
    return null;
  }

  if (state.alertChannelId && state.alertChannelId !== channel.id) {
    return null;
  }

  try {
    return await channel.messages.fetch(state.alertMessageId);
  } catch {
    setGuildRuntimeState(guildId, {
      alertMessageId: null,
      alertChannelId: null
    });
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
    .setFooter({ text: 'Only members with Manage Server can use this panel.' });
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

async function handleSetupCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!hasManageGuildPermission(interaction)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to configure this bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    embeds: [createSetupEmbed(interaction.guild)],
    components: createSetupComponents(),
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
          .setCustomId(SETUP_TOKEN_INPUT_ID)
          .setLabel('Bot Token (optional verification only)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Leave empty to keep using the current token')
      ),
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

async function handleSetupButton(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'This setup button can only be used inside a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!hasManageGuildPermission(interaction)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to configure this bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(createSetupModal(getGuildConfig(interaction.guildId)));
}

async function handleSetupModalSubmit(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: 'This setup form can only be used inside a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!hasManageGuildPermission(interaction)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to configure this bot.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const providedToken = interaction.fields.getTextInputValue(SETUP_TOKEN_INPUT_ID).trim();
  const channelId = interaction.fields.getTextInputValue(SETUP_CHANNEL_INPUT_ID).trim();
  const roleId = interaction.fields.getTextInputValue(SETUP_ROLE_INPUT_ID).trim();

  if (!isSnowflake(channelId) || !isSnowflake(roleId)) {
    await interaction.reply({
      content: 'Channel ID and Role ID must be valid Discord snowflakes.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({
      content: 'The channel ID is invalid or not a text-based channel in this server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({
      content: 'The role ID is invalid or not part of this server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let note = 'Setup saved successfully.';
  if (providedToken && providedToken !== DISCORD_TOKEN) {
    note = 'Channel and role were saved. Token changes still need to be made in `.env` and require a bot restart.';
  }

  setGuildConfig(interaction.guildId, {
    channelId,
    roleId
  });
  setGuildRuntimeState(interaction.guildId, {
    statusMessageId: null,
    statusChannelId: null
  });

  await interaction.reply({
    embeds: [createSetupEmbed(interaction.guild, note)],
    components: createSetupComponents(),
    flags: MessageFlags.Ephemeral
  });
}

async function registerGuildCommands(guild) {
  await guild.commands.set([
    CONFIG_COMMAND.toJSON(),
    SETUP_COMMAND.toJSON()
  ]);
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

function getElectionTimingLines(isOpen) {
  const schedule = getElectionSchedule();
  const targetTimestamp = schedule.nextTransitionAt;

  if (isOpen) {
    return [
      `Election ends: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
    ];
  }

  return [
    `Next election opens: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
  ];
}

function compactMayorPerks(mayor) {
  const perks = Array.isArray(mayor.perks) ? mayor.perks : [];

  if (!perks.length) {
    return 'No perks found';
  }

  return perks.map((perk) => stripMinecraftFormatting(perk.name)).join(' | ');
}

async function sendRolePing(guildId, text) {
  const { roleId } = getGuildConfig(guildId);

  if (!roleId) {
    throw new Error(`Guild ${guildId} does not have a configured ping role.`);
  }

  await replaceAlertMessage(guildId, {
    content: [`<@&${roleId}>`, text].join('\n'),
    allowedMentions: {
      roles: [roleId]
    }
  });
}

async function sendRolePingEmbed(guildId, content, embed) {
  const { roleId } = getGuildConfig(guildId);

  if (!roleId) {
    throw new Error(`Guild ${guildId} does not have a configured ping role.`);
  }

  await replaceAlertMessage(guildId, {
    content: [`<@&${roleId}>`, content].join('\n'),
    embeds: [embed],
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
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
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
        value: getElectionTimingLines(boothOpen === true)[0],
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
  await sendRolePingEmbed(
    guildId,
    `${mayorEmoji} A new mayor has been elected.`,
    createMayorEmbed('New SkyBlock Mayor', mayorEmoji, mayor, boothOpen)
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
      ...getElectionTimingLines(true)
    ].join('\n')
  );
}

async function sendElectionClosedPing(guildId) {
  await sendRolePing(
    guildId,
    [
      ':lock: **Election Booth Closed**',
      ...getElectionTimingLines(false)
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
  const existingMessage = await getStoredStatusMessage(guildId, channel);

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
    const schedule = getElectionSchedule();
    const boothOpen = schedule.boothOpen;
    const currentElectionId = currentElection
      ? String(currentElection.year || data.lastUpdated || 'current-election')
      : null;
    const configuredGuildIds = getConfiguredGuildIds();

    for (const guildId of configuredGuildIds) {
      const state = getGuildRuntimeState(guildId);

      if (state.boothOpen !== boothOpen) {
        setGuildRuntimeState(guildId, {
          ...state,
          boothOpen,
          boothChangedAt: Date.now()
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

    if (currentElectionId && currentElectionId !== lastElectionId) {
      lastElectionId = currentElectionId;
      console.log(`Election cycle detected: ${currentElectionId}`);
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
    const boothOpen = getElectionSchedule().boothOpen;

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
  await registerGuildCommands(guild);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === 'config' || interaction.commandName === 'setup')
    ) {
      await handleSetupCommand(interaction);
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
