const {
  ActionRowBuilder,
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder
} = require('discord.js');

const { WEATHER_ROLE_DEFINITIONS } = require('../config/weatherDefinitions');
const { stripMinecraftFormatting } = require('../utils/skyblock');
const { NO_APP_EMOJIS } = require('../utils/appEmojis');
// Shared with the Spider's Den rain/thunder calendar entries, so both always agree.
const {
  getActiveWeatherWindow,
  getNextWeatherWindow,
  getUpcomingWeatherWindows,
  getWeatherWindow
} = require('../utils/skyblockTime');
const {
  validatePanelRole,
  resolveQuickSetupRoles,
  buildRolePanelEntries,
  hasOutdatedPanelEmojis,
  deleteRolePanels,
  postRolePanel,
  pinRolePanel,
  moveTrackedPostsAfterPanels
} = require('./setupHub/rolePanels');

const WEATHER_CHANNEL_NAME = 'skyblock-weather';
const WEATHER_CHANNEL_TOPIC = 'Hypixel SkyBlock island weather: live forecast and Mild/EXTREME weather pings.';
const UPCOMING_WINDOW_COUNT = 4;
const CLEAR_ICON = 'weather_clear';

const WEATHER_ROLE_DEFINITION_MAP = Object.fromEntries(
  WEATHER_ROLE_DEFINITIONS.map((definition) => [definition.key, definition])
);

const WEATHER_TIERS = {
  mild: { name: 'Mild', color: 0x5dade2 },
  extreme: { name: 'EXTREME', color: 0x8e44ad }
};

const CLEAR_COLOR = 0xf5b041;

const WEATHER_ISLAND_SELECT_ID = 'weather:island';
// Hypixel splits weather lore at this width (Minecraft default-font pixels).
const TOOLTIP_WRAP_WIDTH = 186;

const STAT_STYLES = {
  fishingSpeed: { name: 'Fishing Speed', symbol: '☂', color: '§b' },
  seaCreatureChance: { name: 'Sea Creature Chance', symbol: 'α', color: '§3' },
  treasureChance: { name: 'Treasure Chance', symbol: '⛃', color: '§6' },
  trophyChance: { name: 'Trophy Chance', symbol: '♔', color: '§6' },
  combatWisdom: { name: 'Combat Wisdom', symbol: '☯', color: '§3' },
  farmingFortune: { name: 'Farming Fortune', symbol: '☘', color: '§6' },
  foragingFortune: { name: 'Foraging Fortune', symbol: '☘', color: '§6' },
  miningFortune: { name: 'Mining Fortune', symbol: '☘', color: '§6' },
  miningSpeed: { name: 'Mining Speed', symbol: '⸕', color: '§6' },
  bonusPestChance: { name: 'Bonus Pest Chance', symbol: 'ൠ', color: '§2' },
  overbloom: { name: 'Overbloom', symbol: '☀', color: '§e' },
  tracking: { name: 'Tracking', symbol: '⌕', color: '§d' }
};

const LEADING_FORMAT_CODES_PATTERN = /^(?:§[0-9a-fk-or])*/i;

// Joins pre-wrapped lore lines back into one plain sentence per bullet.
function describeExtraLines(lines) {
  const bullets = [];
  for (const line of lines.map((entry) => stripMinecraftFormatting(entry).trim())) {
    if (line.startsWith('• ') || bullets.length === 0) {
      bullets.push(line.replace(/^• /, ''));
    } else {
      bullets[bullets.length - 1] += ` ${line}`;
    }
  }
  return bullets.map((bullet) => bullet.replace(/\.$/, '')).join(' · ');
}

function weatherTier(name, color, icon, stats, extra = []) {
  return { name, color, icon, stats, extra };
}

function defineIsland(island) {
  return {
    ...island,
    mild: island.tiers.mild.name,
    extreme: island.tiers.extreme.name,
    extremeBonus: describeExtraLines(island.tiers.extreme.extra)
  };
}

const MINING_BREEZE = weatherTier('Breeze', '§b', '≈', [['miningSpeed', 100], ['miningFortune', 25], ['fishingSpeed', 25]]);
const MINING_EXTREME_STATS = [['miningSpeed', 250], ['miningFortune', 50], ['fishingSpeed', 50]];

// Garden, Lotus Atoll, Glacite Tunnels, The End and Moonglade Marsh match in-game
// tooltips; the other islands follow the wiki in the same style.
const WEATHER_ISLANDS = [
  defineIsland({
    key: 'spidersDen',
    label: "Spider's Den",
    color: '§c',
    where: 'in the',
    tiers: {
      mild: weatherTier('Rain', '§9', '☂', [['fishingSpeed', 25], ['combatWisdom', 5], ['seaCreatureChance', 2.5]], [
        '§8 • §aRain Slimes §7spawn'
      ]),
      extreme: weatherTier('Thunderstorm', '§e', '⚡', [['fishingSpeed', 50], ['combatWisdom', 10], ['seaCreatureChance', 5]], [
        '§8 • §aRain Slimes §7and §2Toxic Rain Slimes',
        '§7   spawn'
      ])
    }
  }),
  defineIsland({
    key: 'backwaterBayou',
    label: 'Backwater Bayou',
    color: '§3',
    where: 'on the',
    tiers: {
      mild: weatherTier('Smog', '§7', '☁', [['fishingSpeed', 25], ['treasureChance', 1], ['seaCreatureChance', 2.5]]),
      extreme: weatherTier('Acid Rain', '§a', '☂', [['fishingSpeed', 50], ['treasureChance', 2.5], ['seaCreatureChance', 5]], [
        '§8 • §a+20% §7chance to catch §82 Junk §7at',
        '§7   once'
      ])
    }
  }),
  defineIsland({
    key: 'crimsonIsle',
    label: 'Crimson Isle',
    color: '§c',
    where: 'on the',
    tiers: {
      mild: weatherTier('Ashfall', '§7', '☄', [['fishingSpeed', 25], ['trophyChance', 2.5], ['combatWisdom', 5]]),
      extreme: weatherTier('Hellstorm', '§c', '♨', [['fishingSpeed', 50], ['trophyChance', 5], ['combatWisdom', 10]], [
        '§8 • §6Trophy Fish §7are §a5% §7more likely',
        '§7   to be §6§lGOLD §7or §b§lDIAMOND'
      ])
    }
  }),
  defineIsland({
    key: 'moongladeMarsh',
    label: 'Moonglade Marsh',
    color: '§2',
    where: 'on the',
    tiers: {
      mild: weatherTier('Moonfall', '§9', '☾', [['foragingFortune', 10], ['fishingSpeed', 25], ['seaCreatureChance', 2.5]]),
      extreme: weatherTier('Thunderstorm', '§e', '⚡', [['foragingFortune', 25], ['fishingSpeed', 50], ['seaCreatureChance', 5]], [
        '§8 • §7Gain §a+10% §7more §3Forest Whispers§7.'
      ])
    }
  }),
  defineIsland({
    key: 'lotusAtoll',
    label: 'Lotus Atoll',
    color: '§3',
    where: 'on the',
    tiers: {
      mild: weatherTier('Tropical Rain', '§b', '☂', [['fishingSpeed', 25], ['seaCreatureChance', 2.5], ['trophyChance', 2.5]]),
      extreme: weatherTier('Blossoming', '§d', '✿', [['fishingSpeed', 50], ['seaCreatureChance', 5], ['trophyChance', 5]], [
        '§8 • §aTrophy Frogs §7are §a5% §7more likely',
        '§7   to be §6§lGOLD §7or §b§lDIAMOND'
      ])
    }
  }),
  defineIsland({
    key: 'garden',
    label: 'Garden',
    color: '§a',
    where: 'on the',
    tiers: {
      mild: weatherTier('Rain', '§9', '☂', [['bonusPestChance', 5], ['overbloom', 2.5], ['farmingFortune', 25]]),
      extreme: weatherTier('Blooming', '§d', '✾', [['bonusPestChance', 10], ['overbloom', 5], ['farmingFortune', 50]], [
        '§8 • §7Gain §a+10% §7more §aSowdust'
      ])
    }
  }),
  defineIsland({
    key: 'dwarvenMines',
    label: 'Dwarven Mines',
    color: '§2',
    where: 'in the',
    tiers: {
      mild: MINING_BREEZE,
      extreme: weatherTier('Mist', '§7', '☁', MINING_EXTREME_STATS, ['§8 • §7Gain §a+10% §7more §2Mithril Powder§7.'])
    }
  }),
  defineIsland({
    key: 'crystalHollows',
    label: 'Crystal Hollows',
    color: '§d',
    where: 'in the',
    tiers: {
      mild: MINING_BREEZE,
      extreme: weatherTier('Rockfall', '§6', '☄', MINING_EXTREME_STATS, ['§8 • §7Gain §a+10% §7more §dGemstone Powder§7.'])
    }
  }),
  defineIsland({
    key: 'glaciteTunnels',
    label: 'Glacite Tunnels',
    color: '§b',
    where: 'in the',
    tiers: {
      mild: MINING_BREEZE,
      extreme: weatherTier('Snowstorm', '§f', '❄', MINING_EXTREME_STATS, ['§8 • §7Gain §a+10% §7more §bGlacite Powder§7.'])
    }
  }),
  defineIsland({
    key: 'theEnd',
    label: 'The End',
    color: '§d',
    // The game really says "on the The End".
    where: 'on the',
    tiers: {
      mild: weatherTier('Wispfall', '§7', '☁', [['miningFortune', 25], ['tracking', 1], ['combatWisdom', 5]]),
      extreme: weatherTier('Voidstorm', '§5', '✺', [['miningFortune', 50], ['tracking', 2.5], ['combatWisdom', 10]], [
        '§8 • §eSuperior Dragons §7are §a1% §7more',
        '§7   likely to spawn'
      ])
    }
  }),
  defineIsland({
    key: 'jerrysWorkshop',
    label: "Jerry's Workshop",
    color: '§c',
    where: 'in',
    note: 'Season of Jerry only',
    tiers: {
      mild: weatherTier('Breeze', '§b', '≈', [['fishingSpeed', 25], ['seaCreatureChance', 5], ['treasureChance', 2.5]]),
      extreme: weatherTier('Blizzard', '§f', '❄', [['fishingSpeed', 50], ['seaCreatureChance', 10], ['treasureChance', 5]], [
        '§8 • §7Gain §a+10% §7more §dIce Essence§7.'
      ])
    }
  })
];

const WEATHER_ISLAND_MAP = new Map(WEATHER_ISLANDS.map((island) => [island.key, island]));

// Advance per character including the 1px spacing of Minecraft's default font.
function getMinecraftCharWidth(char) {
  if (char.codePointAt(0) > 0x7e) {
    return 6;
  }
  if ("i!:.,'|;".includes(char)) {
    return 2;
  }
  if (char === 'l') {
    return 3;
  }
  if ('tI[] '.includes(char)) {
    return 4;
  }
  if ('fk<>(){}"*'.includes(char)) {
    return 5;
  }
  return '@~'.includes(char) ? 7 : 6;
}

const PLAIN_STYLE = { color: '', formats: '' };

function applyFormatCode(style, key) {
  if (key === 'r') {
    return PLAIN_STYLE;
  }
  if (/[0-9a-f]/.test(key)) {
    return { color: `§${key}`, formats: '' };
  }
  return /[k-o]/.test(key) && !style.formats.includes(`§${key}`)
    ? { ...style, formats: `${style.formats}§${key}` }
    : style;
}

function measureMinecraftText(text, style = PLAIN_STYLE) {
  let width = 0;
  let current = style;
  for (let index = 0; index < text.length;) {
    if (text[index] === '§' && index + 1 < text.length) {
      current = applyFormatCode(current, text[index + 1].toLowerCase());
      index += 2;
      continue;
    }

    const char = String.fromCodePoint(text.codePointAt(index));
    width += getMinecraftCharWidth(char) + (current.formats.includes('§l') ? 1 : 0);
    index += char.length;
  }

  return { width, style: current };
}

function getMinecraftTextWidth(text) {
  return measureMinecraftText(String(text)).width;
}

// Word-wraps like Hypixel lore; continuation lines restart with the active
// colour and formatting because every lore line starts unformatted.
function wrapMinecraftText(text, maxWidth = TOOLTIP_WRAP_WIDTH) {
  const lines = [];
  let line = null;
  let lineWidth = 0;
  let style = PLAIN_STYLE;

  for (const word of String(text).split(' ')) {
    const leadingCodes = word.match(LEADING_FORMAT_CODES_PATTERN)[0];
    const wordStyle = measureMinecraftText(leadingCodes, style).style;
    const body = word.slice(leadingCodes.length);
    const measured = measureMinecraftText(body, wordStyle);
    const spaceWidth = measureMinecraftText(' ', style).width;

    if (line === null) {
      line = word;
      lineWidth = measured.width;
    } else if (lineWidth + spaceWidth + measured.width <= maxWidth) {
      line += ` ${word}`;
      lineWidth += spaceWidth + measured.width;
    } else {
      lines.push(line);
      line = `${wordStyle.color}${wordStyle.formats}${body}`;
      lineWidth = measured.width;
    }
    style = measured.style;
  }

  if (line !== null) {
    lines.push(line);
  }
  return lines;
}

function buildWeatherTooltipLines(islandKey, tier) {
  const island = WEATHER_ISLAND_MAP.get(islandKey);
  const weather = island && Object.hasOwn(island.tiers, tier) ? island.tiers[tier] : null;
  if (!weather) {
    throw new Error(`Unknown weather island or tier: ${islandKey}/${tier}`);
  }

  return [
    `${weather.color}${weather.icon} ${weather.name}`,
    `§8${tier === 'extreme' ? 'EXTREME' : 'Mild'} Weather`,
    '',
    ...wrapMinecraftText(`§7All players ${island.where} ${island.color}${island.label} §7receive the following stats during ${weather.color}${weather.name}§7:`),
    ...weather.stats.map(([statKey, amount]) => {
      const style = STAT_STYLES[statKey];
      return `§8 • ${style.color}+${amount}${style.symbol} ${style.name}`;
    }),
    ...weather.extra
  ];
}

// Plain-text version of the tooltips, used when the image cannot be rendered.
function createIslandWeatherTextLines(island) {
  return WEATHER_ROLE_DEFINITIONS.map(({ key, emoji }) => {
    const weather = island.tiers[key];
    const stats = weather.stats.map(([statKey, amount]) => `+${amount} ${STAT_STYLES[statKey].name}`).join(', ');
    const extra = weather.extra.length > 0 ? ` · ${describeExtraLines(weather.extra)}` : '';
    return `${emoji} **${WEATHER_TIERS[key].name} — ${weather.name}**: ${stats}${extra}`;
  });
}

function renderTooltipsLazily(...args) {
  return require('../utils/minecraftTooltip').renderTooltips(...args);
}

function toUnixSeconds(timestampMs) {
  return Math.floor(timestampMs / 1000);
}

function formatIslandLabel(island) {
  return island.note ? `${island.label} (${island.note})` : island.label;
}

function getTierIcon(tierKey, appEmojis) {
  const definition = WEATHER_ROLE_DEFINITION_MAP[tierKey];
  return appEmojis.get(definition.icon, definition.emoji);
}

function createWeatherStatusLine(window, now, appEmojis = NO_APP_EMOJIS) {
  const icon = getTierIcon(window.tier, appEmojis);
  const tierName = WEATHER_TIERS[window.tier].name;
  const end = toUnixSeconds(window.endAt);
  if (window.startAt <= now && now < window.endAt) {
    return `${icon} ${tierName} weather is active now — until <t:${end}:t> (<t:${end}:R>).`;
  }

  const start = toUnixSeconds(window.startAt);
  return `${icon} Next ${tierName} weather: <t:${start}:t>–<t:${end}:t> (<t:${start}:R>).`;
}

// Titles do not render custom emojis, so the tier icon is the thumbnail.
function createWeatherPingEmbed(window, { isTest = false, appEmojis = NO_APP_EMOJIS } = {}) {
  const tier = WEATHER_TIERS[window.tier];
  const islandLines = WEATHER_ISLANDS.map((island) => `${formatIslandLabel(island)} — ${island[window.tier]}`);

  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setTitle(`${tier.name} weather on every weather island`)
    .setDescription([...islandLines, '', 'Pick an island under the dashboard for details.'].join('\n'));

  const iconUrl = appEmojis.url(WEATHER_ROLE_DEFINITION_MAP[window.tier].icon);
  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }

  if (isTest) {
    embed.setFooter({ text: 'Test ping · no live weather alert' });
  }

  return embed;
}

function createWeatherPingPayload(window, roleId, now, { isTest = false, appEmojis = NO_APP_EMOJIS } = {}) {
  const statusLine = createWeatherStatusLine(window, now, appEmojis);
  const text = isTest ? `Test ping · ${statusLine}` : statusLine;
  return {
    content: roleId ? `<@&${roleId}>\n${text}` : text,
    embeds: [createWeatherPingEmbed(window, { isTest, appEmojis })],
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
  };
}

function formatWindowTime(window) {
  const start = toUnixSeconds(window.startAt);
  return `<t:${start}:t> (<t:${start}:R>)`;
}

// Field names and titles do not render custom emojis, so the tier icons lead the values instead.
function createWeatherDashboardEmbed(now, appEmojis = NO_APP_EMOJIS) {
  const activeWindow = getActiveWeatherWindow(now);
  const nextMild = getNextWeatherWindow(now, 'mild');
  const nextExtreme = getNextWeatherWindow(now, 'extreme');
  const upcomingLines = getUpcomingWeatherWindows(now, UPCOMING_WINDOW_COUNT).map((window) => {
    const tierName = WEATHER_TIERS[window.tier].name;
    const label = window.tier === 'extreme' ? `**${tierName}**` : tierName;
    return `${getTierIcon(window.tier, appEmojis)} <t:${toUnixSeconds(window.startAt)}:t>–<t:${toUnixSeconds(window.endAt)}:t> · ${label}`;
  });

  let statusLine = `${appEmojis.get(CLEAR_ICON, '☀️')} **Clear** — no island weather right now.`;
  if (activeWindow) {
    const end = toUnixSeconds(activeWindow.endAt);
    statusLine = `${getTierIcon(activeWindow.tier, appEmojis)} **${WEATHER_TIERS[activeWindow.tier].name} weather** is active until <t:${end}:t> (<t:${end}:R>).`;
  }

  return new EmbedBuilder()
    .setColor(activeWindow ? WEATHER_TIERS[activeWindow.tier].color : CLEAR_COLOR)
    .setTitle('SkyBlock Weather')
    .setDescription(statusLine)
    .addFields(
      { name: 'Next Mild', value: `${getTierIcon('mild', appEmojis)} ${formatWindowTime(nextMild)}`, inline: true },
      { name: 'Next EXTREME', value: `${getTierIcon('extreme', appEmojis)} ${formatWindowTime(nextExtreme)}`, inline: true },
      { name: 'Upcoming', value: upcomingLines.join('\n') }
    )
    .setFooter({ text: 'Pick an island below for its weather stats · times in your local time' });
}

function createIslandSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(WEATHER_ISLAND_SELECT_ID)
      .setPlaceholder('Choose an island for weather details')
      .addOptions(WEATHER_ISLANDS.map((island) => ({
        label: island.label,
        value: island.key,
        description: [`${island.mild} / ${island.extreme}`, island.note].filter(Boolean).join(' · ')
      })))
  );
}

function createWeatherDashboardPayload(now, appEmojis = NO_APP_EMOJIS) {
  return {
    embeds: [createWeatherDashboardEmbed(now, appEmojis)],
    components: [createIslandSelectRow()]
  };
}

// Changes only when the active or next window changes, so the dashboard is
// edited twice per hour; the <t:..:R> timestamps tick client-side. The version
// prefix forces one edit of older dashboards after a layout change.
function getDashboardStateKey(now) {
  const activeWindow = getActiveWeatherWindow(now);
  return `v3:${activeWindow ? activeWindow.index : 'clear'}:${getNextWeatherWindow(now).index}`;
}

function createIslandSelectSummary(island, now) {
  const nextMild = getNextWeatherWindow(now, 'mild');
  const nextExtreme = getNextWeatherWindow(now, 'extreme');
  const parts = [
    `**${island.label}**${island.note ? ` (${island.note})` : ''}`,
    `next Mild <t:${toUnixSeconds(nextMild.startAt)}:R>`,
    `next EXTREME <t:${toUnixSeconds(nextExtreme.startAt)}:R>`
  ];
  const activeWindow = getActiveWeatherWindow(now);
  if (activeWindow) {
    parts.push(`${WEATHER_TIERS[activeWindow.tier].name} active now until <t:${toUnixSeconds(activeWindow.endAt)}:t>`);
  }

  return parts.join(' · ');
}

function createWeatherRolePanelEmbed(roleEntries) {
  const descriptions = {
    mild: 'Mild weather pings (2 of every 3 hours)',
    extreme: 'EXTREME weather pings every 3 hours'
  };

  return new EmbedBuilder()
    .setColor(WEATHER_TIERS.extreme.color)
    .setTitle('SkyBlock Weather Pings')
    .setDescription([
      'React to get pinged when island weather starts. Remove your reaction to stop.',
      '',
      ...roleEntries.map(({ key, emoji, roleId }) => `${emoji} ${descriptions[key]} → <@&${roleId}>`)
    ].join('\n'));
}

function mapWeatherTiers(getValue) {
  return Object.fromEntries(WEATHER_ROLE_DEFINITIONS.map((definition) => [definition.key, getValue(definition.key)]));
}

function createWeatherService({ client, store, reactionRoles, renderTooltips = renderTooltipsLazily, appEmojis = NO_APP_EMOJIS }) {
  const guildLocks = new Map();
  const tooltipImages = new Map();

  // Serializes everything that rewrites a guild's tracked weather messages
  // (check loop, quick setup, startup repair, setup editor). Code running under
  // the lock must only call the unlocked helpers, never a locking method.
  function withGuildLock(guildId, task) {
    const run = (guildLocks.get(guildId) || Promise.resolve()).then(() => task());
    const settled = run.then(() => undefined, () => undefined);
    guildLocks.set(guildId, settled);
    settled.then(() => {
      if (guildLocks.get(guildId) === settled) {
        guildLocks.delete(guildId);
      }
    });
    return run;
  }

  function getWeatherRuntimeState(guildId) {
    return store.getGuildRuntimeState(guildId).weather;
  }

  // Patches may be functions of the latest state, so nested maps are rebuilt
  // from what is stored right now instead of a copy read before an await.
  function updateWeatherRuntimeState(guildId, patch) {
    store.updateGuildRuntimeSection(guildId, 'weather', patch);
  }

  async function deleteMessage(channel, messageId) {
    if (!channel || !messageId || !channel.isTextBased()) {
      return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.delete().catch(() => null);
    }
  }

  async function fetchConfiguredChannel(guildId) {
    const channelId = store.getGuildConfig(guildId).weather.channelId;
    if (!channelId) {
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel && channel.isTextBased() ? channel : null;
  }

  async function deleteTrackedWeatherMessages(guildId) {
    const tracked = getWeatherRuntimeState(guildId);
    const messageIds = [tracked.dashboardMessageId, ...Object.values(tracked.pingMessageIds)].filter(Boolean);

    if (tracked.channelId && messageIds.length > 0) {
      const channel = await client.channels.fetch(tracked.channelId).catch(() => null);
      for (const messageId of messageIds) {
        await deleteMessage(channel, messageId);
      }
    }

    // Only forget the ids deleted above; anything posted meanwhile stays tracked.
    updateWeatherRuntimeState(guildId, (latest) => {
      const dashboardDeleted = latest.dashboardMessageId === tracked.dashboardMessageId;
      const pingMessageIds = mapWeatherTiers((tier) =>
        (latest.pingMessageIds[tier] === tracked.pingMessageIds[tier] ? null : latest.pingMessageIds[tier]));
      const stillTracked = (!dashboardDeleted && latest.dashboardMessageId) || Object.values(pingMessageIds).some(Boolean);

      return {
        channelId: stillTracked ? latest.channelId : null,
        dashboardMessageId: dashboardDeleted ? null : latest.dashboardMessageId,
        dashboardStateKey: dashboardDeleted ? null : latest.dashboardStateKey,
        pingMessageIds,
        pingExpireAts: mapWeatherTiers((tier) => (pingMessageIds[tier] ? latest.pingExpireAts[tier] : null))
      };
    });
  }

  // Messages tracked in a previously configured channel are removed before
  // anything is posted to the new one.
  async function releaseStaleWeatherChannel(guildId, channel) {
    const runtimeChannelId = getWeatherRuntimeState(guildId).channelId;
    if (runtimeChannelId && runtimeChannelId !== channel.id) {
      await deleteTrackedWeatherMessages(guildId);
    }
  }

  async function deleteWeatherPing(guildId, channel, tier) {
    const messageId = getWeatherRuntimeState(guildId).pingMessageIds[tier] || null;
    if (!messageId) {
      return;
    }

    await deleteMessage(channel, messageId);
    updateWeatherRuntimeState(guildId, (latest) => (latest.pingMessageIds[tier] === messageId
      ? {
        pingMessageIds: { ...latest.pingMessageIds, [tier]: null },
        pingExpireAts: { ...latest.pingExpireAts, [tier]: null }
      }
      : {}));
  }

  async function deleteExpiredWeatherPings(guildId, channel, now) {
    for (const definition of WEATHER_ROLE_DEFINITIONS) {
      const expireAt = getWeatherRuntimeState(guildId).pingExpireAts[definition.key];
      if (Number.isFinite(expireAt) && expireAt <= now) {
        await deleteWeatherPing(guildId, channel, definition.key);
      }
    }
  }

  async function sendWeatherPing(guildId, channel, window, roleId, now) {
    await deleteWeatherPing(guildId, channel, window.tier);

    const message = await channel.send(createWeatherPingPayload(window, roleId, now, { appEmojis }));
    updateWeatherRuntimeState(guildId, (latest) => ({
      channelId: channel.id,
      pingMessageIds: { ...latest.pingMessageIds, [window.tier]: message.id },
      pingExpireAts: { ...latest.pingExpireAts, [window.tier]: window.endAt }
    }));
  }

  // Public helpers below that change tracked messages do not lock themselves;
  // callers outside this service wrap them in withGuildLock.
  async function syncWeatherDashboard(guildId, now = Date.now()) {
    const channel = await fetchConfiguredChannel(guildId);
    if (!channel) {
      return null;
    }

    await releaseStaleWeatherChannel(guildId, channel);

    const runtimeState = getWeatherRuntimeState(guildId);
    const stateKey = getDashboardStateKey(now);
    const existingMessage = runtimeState.dashboardMessageId
      ? await channel.messages.fetch(runtimeState.dashboardMessageId).catch(() => null)
      : null;

    if (existingMessage) {
      if (runtimeState.dashboardStateKey === stateKey) {
        return existingMessage;
      }

      const editedMessage = await existingMessage.edit(createWeatherDashboardPayload(now, appEmojis)).catch(() => null);
      if (editedMessage) {
        updateWeatherRuntimeState(guildId, (latest) => (latest.dashboardMessageId === existingMessage.id
          ? { dashboardStateKey: stateKey }
          : {}));
      }
      return existingMessage;
    }

    const message = await channel.send({
      ...createWeatherDashboardPayload(now, appEmojis),
      allowedMentions: { parse: [] }
    });
    updateWeatherRuntimeState(guildId, {
      channelId: channel.id,
      dashboardMessageId: message.id,
      dashboardStateKey: stateKey
    });
    return message;
  }

  async function checkGuildWeather(guildId, now, activeWindow) {
    const config = store.getGuildConfig(guildId).weather;
    const channel = await fetchConfiguredChannel(guildId);
    if (!channel) {
      return;
    }

    await releaseStaleWeatherChannel(guildId, channel);
    await deleteExpiredWeatherPings(guildId, channel, now);

    if (activeWindow && getWeatherRuntimeState(guildId).lastSentStarts[activeWindow.tier] !== activeWindow.startAt) {
      const roleId = config.roles[activeWindow.tier] || null;
      if (roleId) {
        await sendWeatherPing(guildId, channel, activeWindow, roleId, now);
      }

      // Marked as handled even without a role, so choosing a role later does
      // not ping halfway through a window that already started.
      updateWeatherRuntimeState(guildId, (latest) => ({
        lastSentStarts: { ...latest.lastSentStarts, [activeWindow.tier]: activeWindow.startAt }
      }));
    }

    await syncWeatherDashboard(guildId, now);
  }

  async function checkForWeather(now = Date.now()) {
    const activeWindow = getActiveWeatherWindow(now);

    for (const guildId of store.getWeatherConfiguredGuildIds()) {
      try {
        await withGuildLock(guildId, () => checkGuildWeather(guildId, now, activeWindow));
      } catch (error) {
        console.error(`Weather check failed for guild ${guildId}:`, error);
      }
    }
  }

  // Only a real category is a usable parent: a thread's parent is a text channel.
  async function getCategoryParentId(guild, channel) {
    if (!channel?.parentId || channel.isThread?.()) {
      return null;
    }

    const parent = channel.parent ?? await guild.channels.fetch(channel.parentId).catch(() => null);
    return parent?.type === ChannelType.GuildCategory ? parent.id : null;
  }

  async function findBotChannelCategoryId(guild, fallbackChannel = null) {
    const config = store.getGuildConfig(guild.id);
    const channelIds = [
      config.weather.channelId,
      config.miningEvents.channelId,
      config.eventReminders.channelId || config.channelId,
      config.modUpdates.channelId
    ].filter(Boolean);

    for (const channelId of new Set(channelIds)) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      const parentId = await getCategoryParentId(guild, channel);
      if (parentId) {
        return parentId;
      }
    }

    return getCategoryParentId(guild, fallbackChannel);
  }

  async function resolveWeatherChannel(guild, { parentId = null } = {}) {
    const existingChannelId = store.getGuildConfig(guild.id).weather.channelId;
    if (existingChannelId) {
      const existingChannel = await guild.channels.fetch(existingChannelId).catch(() => null);
      if (existingChannel && existingChannel.isTextBased()) {
        return existingChannel;
      }
    }

    const fetchedChannels = await guild.channels.fetch();
    const matchingChannel = [...fetchedChannels.values()]
      .find((channel) => channel && channel.isTextBased() && channel.name === WEATHER_CHANNEL_NAME);
    if (matchingChannel) {
      return matchingChannel;
    }

    const parent = parentId ?? (await findBotChannelCategoryId(guild)) ?? undefined;
    return guild.channels.create({
      name: WEATHER_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent,
      topic: WEATHER_CHANNEL_TOPIC,
      reason: 'Quick setup for the Weather feature'
    });
  }

  async function validateWeatherPanelRole(guild, roleId) {
    return validatePanelRole(guild, roleId, store.getGuildConfig(guild.id).botManagers.roleIds, 'weather ping role');
  }

  async function resolveQuickSetupWeatherRoles(guild) {
    const config = store.getGuildConfig(guild.id);
    return resolveQuickSetupRoles(guild, WEATHER_ROLE_DEFINITIONS, config.weather.roles, config.botManagers.roleIds);
  }

  async function deleteWeatherRolePanel(guild) {
    await deleteRolePanels({ guild, store, reactionRoles, section: 'weather', messageKeys: ['rolePanelMessageId'] });
  }

  async function getPanelPermissionWarning(guild, channel) {
    const me = guild.members.me || await guild.members.fetchMe();
    const canReact = channel.permissionsFor(me)?.has(PermissionsBitField.Flags.AddReactions);
    if (canReact && me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return null;
    }

    return 'Weather role panel not posted: the bot needs Add Reactions in the weather channel and Manage Roles.';
  }

  async function postWeatherRolePanel(guild, channel, roles) {
    const warnings = [];
    await deleteWeatherRolePanel(guild);

    const configuredDefinitions = WEATHER_ROLE_DEFINITIONS.filter((definition) => roles?.[definition.key]);
    if (configuredDefinitions.length === 0) {
      return { message: null, warnings };
    }

    const permissionWarning = await getPanelPermissionWarning(guild, channel);
    if (permissionWarning) {
      return { message: null, warnings: [permissionWarning] };
    }

    const safeDefinitions = [];
    for (const definition of configuredDefinitions) {
      try {
        await validateWeatherPanelRole(guild, roles[definition.key]);
        safeDefinitions.push(definition);
      } catch (error) {
        warnings.push(`${definition.label} role left off the panel: ${error.message}`);
      }
    }
    if (safeDefinitions.length === 0) {
      return { message: null, warnings };
    }

    const entries = buildRolePanelEntries(safeDefinitions, roles, appEmojis);
    const { message, warning } = await postRolePanel({
      guild, store, reactionRoles, channel, section: 'weather', messageKey: 'rolePanelMessageId', entries, embed: createWeatherRolePanelEmbed(entries)
    });
    if (warning) {
      warnings.push(warning);
    }

    await moveTrackedPostsAfterPanels({ guild, store, section: 'weather', channelId: channel.id, afterId: message.id });
    return { message, warnings };
  }

  async function repairWeatherRolePanel(guild) {
    const config = store.getGuildConfig(guild.id).weather;
    if (!config.channelId || !WEATHER_ROLE_DEFINITIONS.some((definition) => config.roles[definition.key])) {
      return;
    }

    const channel = await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const runtimeState = getWeatherRuntimeState(guild.id);
    const panel = runtimeState.rolePanelMessageId && runtimeState.rolePanelChannelId === channel.id
      ? await channel.messages.fetch(runtimeState.rolePanelMessageId).catch(() => null)
      : null;
    const trackedIds = runtimeState.channelId === channel.id
      ? [runtimeState.dashboardMessageId, ...Object.values(runtimeState.pingMessageIds)].filter(Boolean)
      : [];
    const isBelowTrackedPosts = Boolean(panel) && trackedIds.some((messageId) => BigInt(messageId) < BigInt(panel.id));
    // A role may have gained moderator permissions since the panel was posted.
    const boundRoleIds = panel
      ? store.getReactionRoleEntries(guild.id)
        .filter((entry) => entry.channelId === channel.id && entry.messageId === panel.id)
        .map((entry) => entry.roleId)
      : [];
    const unsafeBindings = await Promise.all(boundRoleIds.map((roleId) =>
      validateWeatherPanelRole(guild, roleId).then(() => false, () => true)));

    // Panels posted before the item icons still react with the Unicode emojis.
    const hasOutdatedEmojis = hasOutdatedPanelEmojis(store, guild.id, panel, buildRolePanelEntries(WEATHER_ROLE_DEFINITIONS, config.roles, appEmojis));

    if (!panel || panel.author?.id !== client.user?.id || isBelowTrackedPosts || unsafeBindings.some(Boolean) || hasOutdatedEmojis) {
      const { warnings } = await postWeatherRolePanel(guild, channel, config.roles);
      for (const warning of warnings) {
        console.warn(warning);
      }
      return;
    }

    const warning = await pinRolePanel(panel);
    if (warning) {
      console.warn(warning);
    }
  }

  async function ensureWeatherRolePanel(guild) {
    try {
      await withGuildLock(guild.id, () => repairWeatherRolePanel(guild));
    } catch (error) {
      console.warn(`Weather role panel for ${guild.id}: ${error.message}`);
    }
  }

  async function runQuickSetup(guild, { parentId = null } = {}) {
    return withGuildLock(guild.id, async () => {
      const channel = await resolveWeatherChannel(guild, { parentId });
      const { roles, createdCount } = await resolveQuickSetupWeatherRoles(guild);
      const existingConfig = store.getGuildConfig(guild.id).weather;

      if (existingConfig.channelId !== channel.id) {
        await deleteTrackedWeatherMessages(guild.id);
        await deleteWeatherRolePanel(guild);
      }

      store.setGuildConfig(guild.id, {
        weather: {
          ...existingConfig,
          channelId: channel.id,
          roles
        }
      });

      const { warnings } = await postWeatherRolePanel(guild, channel, roles);
      await syncWeatherDashboard(guild.id);
      return { channel, roles, createdCount, warnings };
    });
  }

  async function sendTestWeatherPing(guildId, tier) {
    if (!WEATHER_ROLE_DEFINITION_MAP[tier]) {
      throw new Error(`Unknown weather tier: ${tier}`);
    }

    const config = store.getGuildConfig(guildId).weather;
    if (!config.channelId) {
      throw new Error(`Guild ${guildId} does not have a configured weather channel.`);
    }

    const channel = await fetchConfiguredChannel(guildId);
    if (!channel) {
      throw new Error('Configured weather channel is not a text channel.');
    }

    const now = Date.now();
    const activeWindow = getActiveWeatherWindow(now);
    const window = activeWindow?.tier === tier ? activeWindow : getNextWeatherWindow(now, tier);
    return channel.send(createWeatherPingPayload(window, config.roles[tier] || null, now, { isTest: true, appEmojis }));
  }

  // Rendered once per island and process; a failed render is retried next time.
  function getIslandTooltipImage(islandKey) {
    if (!tooltipImages.has(islandKey)) {
      const rendering = Promise.resolve().then(() => renderTooltips([
        buildWeatherTooltipLines(islandKey, 'mild'),
        buildWeatherTooltipLines(islandKey, 'extreme')
      ], { direction: 'column' }));
      tooltipImages.set(islandKey, rendering);
      rendering.catch(() => {
        if (tooltipImages.get(islandKey) === rendering) {
          tooltipImages.delete(islandKey);
        }
      });
    }

    return tooltipImages.get(islandKey);
  }

  // Read-only: answers with an ephemeral image and never takes the guild lock.
  async function handleIslandSelect(interaction, now = Date.now()) {
    const island = WEATHER_ISLAND_MAP.get(interaction.values?.[0]);
    if (!island) {
      await interaction.reply({ content: 'Unknown island. Pick one from the list again.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const summary = createIslandSelectSummary(island, now);
    try {
      const image = await getIslandTooltipImage(island.key);
      await interaction.editReply({
        content: summary,
        files: [new AttachmentBuilder(image, { name: `weather-${island.key}.png` })]
      });
    } catch (error) {
      console.error(`Weather tooltip for ${island.key} failed:`, error);
      await interaction.editReply({ content: [summary, '', ...createIslandWeatherTextLines(island)].join('\n') });
    }
  }

  function getWeatherSummary(now = Date.now()) {
    const activeWindow = getActiveWeatherWindow(now);
    if (activeWindow) {
      return `${WEATHER_TIERS[activeWindow.tier].name} weather active until <t:${toUnixSeconds(activeWindow.endAt)}:t>`;
    }

    const nextWindow = getNextWeatherWindow(now);
    return `Clear · next: ${WEATHER_TIERS[nextWindow.tier].name} <t:${toUnixSeconds(nextWindow.startAt)}:R>`;
  }

  return {
    withGuildLock,
    checkForWeather,
    syncWeatherDashboard,
    deleteTrackedWeatherMessages,
    findBotChannelCategoryId,
    validateWeatherPanelRole,
    resolveQuickSetupWeatherRoles,
    deleteWeatherRolePanel,
    postWeatherRolePanel,
    ensureWeatherRolePanel,
    runQuickSetup,
    sendTestWeatherPing,
    handleIslandSelect,
    getWeatherSummary
  };
}

module.exports = {
  WEATHER_ROLE_DEFINITIONS,
  WEATHER_ISLANDS,
  WEATHER_CHANNEL_NAME,
  WEATHER_ISLAND_SELECT_ID,
  STAT_STYLES,
  getMinecraftTextWidth,
  wrapMinecraftText,
  buildWeatherTooltipLines,
  getWeatherWindow,
  getActiveWeatherWindow,
  getNextWeatherWindow,
  getUpcomingWeatherWindows,
  createWeatherService
};
