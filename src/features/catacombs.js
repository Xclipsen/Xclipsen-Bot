const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');
const { normalizeUuid, selectProfile } = require('../utils/hypixelApi');
const { NO_APP_EMOJIS } = require('../utils/appEmojis');

const CATACOMBS_XP_TABLE = [
  0,
  50,
  75,
  110,
  160,
  230,
  330,
  470,
  670,
  950,
  1340,
  1890,
  2665,
  3760,
  5260,
  7380,
  10300,
  14400,
  20000,
  27600,
  38000,
  52500,
  71500,
  97000,
  132000,
  180000,
  243000,
  328000,
  445000,
  600000,
  800000,
  1065000,
  1410000,
  1900000,
  2500000,
  3300000,
  4300000,
  5600000,
  7200000,
  9200000,
  12000000,
  15000000,
  19000000,
  24000000,
  30000000,
  38000000,
  48000000,
  60000000,
  75000000,
  93000000,
  116250000
];
const LEVEL_50_TOTAL_XP = CATACOMBS_XP_TABLE.slice(1).reduce((sum, value) => sum + value, 0);
const DUNGEON_OVERFLOW_XP = 200000000;
const CLASS_ORDER = ['healer', 'mage', 'berserk', 'archer', 'tank'];
const FLOOR_RANGES = {
  F: { start: 0, end: 7 },
  M: { start: 1, end: 7 }
};
const CATACOMBS_VIEW_BASIC = 'basic';
const CATACOMBS_VIEW_BOSS_COLLECTIONS = 'boss';
// View buttons carry `cata:<view>:<uuid>:<profile id>:<player name>` (at most 93 characters),
// so they keep working after a restart. Buttons from older bot versions used fixed ids.
const CATACOMBS_VIEW_BUTTON_PREFIX = 'cata:';
const LEGACY_CATACOMBS_VIEW_BUTTON_IDS = new Set(['catacombs-view-basic', 'catacombs-view-boss-collections']);
const BOSS_COLLECTIONS = [
  { key: 'bonzo', label: 'Bonzo', emoji: '🤡', icon: 'boss_bonzo', killSource: { type: 'catacombs', floor: '1' }, thresholds: [25, 50, 100, 150, 250, 1000] },
  { key: 'scarf', label: 'Scarf', emoji: '🧣', icon: 'boss_scarf', killSource: { type: 'catacombs', floor: '2' }, thresholds: [25, 50, 100, 150, 250, 1000] },
  { key: 'professor', label: 'The Professor', emoji: '🎓', icon: 'boss_professor', killSource: { type: 'catacombs', floor: '3' }, thresholds: [25, 50, 100, 150, 250, 1000] },
  { key: 'thorn', label: 'Thorn', emoji: '🦴', icon: 'boss_thorn', killSource: { type: 'catacombs', floor: '4' }, thresholds: [50, 100, 150, 250, 400, 1000] },
  { key: 'livid', label: 'Livid', emoji: '🗡️', icon: 'boss_livid', killSource: { type: 'catacombs', floor: '5' }, thresholds: [50, 100, 150, 250, 500, 750, 1000] },
  { key: 'sadan', label: 'Sadan', emoji: '🪵', icon: 'boss_sadan', killSource: { type: 'catacombs', floor: '6' }, thresholds: [50, 100, 150, 250, 500, 750, 1000] },
  { key: 'necron', label: 'Necron', emoji: '💎', icon: 'boss_necron', killSource: { type: 'catacombs', floor: '7' }, thresholds: [50, 100, 150, 250, 500, 750, 1000] },
  { key: 'kuudra', label: 'Kuudra', emoji: '🌋', icon: 'boss_kuudra', killSource: { type: 'kuudra' }, thresholds: [10, 100, 500, 2000, 5000] }
];

function createCatacombsFeature({ env, minecraft, linkStore, hypixelApi, appEmojis = NO_APP_EMOJIS }) {
  // Item icons (assets/app-emojis) with the Unicode emoji as fallback.
  const icon = (name, fallback) => appEmojis.get(name, fallback);

  function calculateLevel(experience = 0) {
    let remaining = Math.max(0, Number(experience) || 0);
    let level = 0;

    for (let i = 1; i < CATACOMBS_XP_TABLE.length; i += 1) {
      const needed = CATACOMBS_XP_TABLE[i];
      if (remaining < needed) {
        return {
          level: Number((level + (remaining / needed)).toFixed(2)),
          progress: needed === 0 ? 0 : remaining / needed,
          experience: Math.max(0, Number(experience) || 0)
        };
      }

      remaining -= needed;
      level = i;
    }

    return {
      level,
      progress: 1,
      experience: Math.max(0, Number(experience) || 0)
    };
  }

  function getOverflowLevel(experience = 0) {
    const normalizedExperience = Math.max(0, Number(experience) || 0);
    if (normalizedExperience <= LEVEL_50_TOTAL_XP) {
      return calculateLevel(normalizedExperience).level;
    }

    return 50 + ((normalizedExperience - LEVEL_50_TOTAL_XP) / DUNGEON_OVERFLOW_XP);
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'Unknown';
    }

    return new Intl.NumberFormat('en-US').format(value);
  }

  function formatCompactNumber(value) {
    const number = Math.max(0, Number(value) || 0);

    if (number >= 1000000000) {
      return `${(number / 1000000000).toFixed(1).replace(/\.0$/, '')}B`;
    }

    if (number >= 1000000) {
      return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    }

    if (number >= 1000) {
      return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }

    return String(Math.round(number));
  }

  function formatDuration(milliseconds) {
    const totalMilliseconds = Math.max(0, Number(milliseconds) || 0);
    if (!totalMilliseconds) {
      return '-';
    }

    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const ms = totalMilliseconds % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function compactCustomEmojiToken(value, fallbackName) {
    const match = String(value || '').match(/^<(a?):[^:>]+:(\d+)>$/);
    if (!match) {
      return String(value || '');
    }

    return match[1] === 'a'
      ? `<a:${fallbackName}:${match[2]}>`
      : `<:${fallbackName}:${match[2]}>`;
  }

  function buildMaxedProgressBar(percentage, length = 10) {
    const filledEmoji = compactCustomEmojiToken(env.VOTE_BAR_FILLED_EMOJI, 'l');
    const emptyEmoji = compactCustomEmojiToken(env.VOTE_BAR_EMPTY_EMOJI, 'e');
    const normalizedPercentage = Math.max(0, Number(percentage) || 0);
    const filled = Math.max(
      normalizedPercentage > 0 ? 1 : 0,
      Math.min(length, Math.round((Math.min(100, normalizedPercentage) / 100) * length))
    );

    return `${filledEmoji.repeat(filled)}${emptyEmoji.repeat(Math.max(0, length - filled))}`;
  }

  function formatLevelSummary(experience = 0, options = {}) {
    const baseLevel = calculateLevel(experience).level;
    const overflowLevel = getOverflowLevel(experience);

    if (options.wholeNumber === true) {
      const base = Math.floor(baseLevel);
      return overflowLevel > 50
        ? `${base} (${overflowLevel.toFixed(2)})`
        : String(base);
    }

    return overflowLevel > 50
      ? `50 (${overflowLevel.toFixed(2)})`
      : baseLevel.toFixed(options.decimals ?? 2);
  }

  function getCompletionRuns(dungeons = {}) {
    return Number(dungeons?.tier_completions?.total)
      || Object.entries(dungeons?.tier_completions || {})
        .filter(([key]) => /^\d+$/.test(key))
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
  }

  function getBloodMobKills(catacombs = {}) {
    return Number(catacombs?.watcher_kills?.total)
      || Number(catacombs?.mobs_killed?.blood_mobs)
      || 0;
  }

  function formatClassName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : 'Unknown';
  }

  function summarizeClasses(classes = {}) {
    const levels = CLASS_ORDER
      .map((name) => ({
        name,
        experience: Number(classes?.[name]?.experience) || 0,
        baseLevel: calculateLevel(classes?.[name]?.experience ?? 0).level,
        overflowLevel: getOverflowLevel(classes?.[name]?.experience ?? 0)
      }))
      .filter((entry) => entry.experience > 0);

    if (levels.length === 0) {
      return null;
    }

    const totalBase = levels.reduce((sum, entry) => sum + entry.baseLevel, 0);
    const totalOverflow = levels.reduce((sum, entry) => sum + entry.overflowLevel, 0);

    return {
      averageBaseLevel: totalBase / levels.length,
      averageOverflowLevel: totalOverflow / levels.length
    };
  }

  function buildFloorKeys(prefix, dungeons = {}) {
    const range = FLOOR_RANGES[prefix] || FLOOR_RANGES.F;
    const defaultKeys = Array.from(
      { length: (range.end - range.start) + 1 },
      (_, index) => String(range.start + index)
    );
    const extraKeys = [...new Set([
      ...Object.keys(dungeons?.tier_completions || {}),
      ...Object.keys(dungeons?.fastest_time_s_plus || {}),
      ...Object.keys(dungeons?.fastest_time_s || {})
    ])]
      .filter((key) => /^\d+$/.test(key) && (Number(key) < range.start || Number(key) > range.end))
      .sort((a, b) => Number(a) - Number(b));

    return [...defaultKeys, ...extraKeys];
  }

  function formatFloorLines(prefix, dungeons = {}) {
    const completions = dungeons?.tier_completions || {};
    const fastestSPlus = dungeons?.fastest_time_s_plus || {};
    const rows = buildFloorKeys(prefix, dungeons).map((key) => ({
      label: `${prefix}${key}`,
      runs: `${formatNumber(Number(completions[key]) || 0)} runs`,
      pbSPlus: formatDuration(fastestSPlus[key])
    }));

    const runsWidth = rows.reduce((width, row) => Math.max(width, row.runs.length), 0);
    const pbSPlusWidth = rows.reduce((width, row) => Math.max(width, row.pbSPlus.length), 0);

    return rows
      .map((row) => (
        `**${row.label}**: \`${row.runs.padStart(runsWidth, ' ')}\` | PB S+: \`${row.pbSPlus.padEnd(pbSPlusWidth, ' ')}\``
      ))
      .join('\n');
  }

  function buildViewButtonId(view, { uuid, profileId, playerName }) {
    return `${CATACOMBS_VIEW_BUTTON_PREFIX}${view}:${normalizeUuid(uuid)}:${normalizeUuid(profileId)}:${playerName}`;
  }

  function parseViewButtonId(customId) {
    const [view, uuid, profileId, playerName] = customId.slice(CATACOMBS_VIEW_BUTTON_PREFIX.length).split(':');
    return [CATACOMBS_VIEW_BASIC, CATACOMBS_VIEW_BOSS_COLLECTIONS].includes(view) && uuid && profileId && playerName
      ? { view, uuid, profileId, playerName }
      : null;
  }

  function buildViewComponents(selectedView, context) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildViewButtonId(CATACOMBS_VIEW_BASIC, context))
          .setLabel('Basic Info')
          .setStyle(selectedView === CATACOMBS_VIEW_BASIC ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildViewButtonId(CATACOMBS_VIEW_BOSS_COLLECTIONS, context))
          .setLabel('Boss Collections')
          .setStyle(selectedView === CATACOMBS_VIEW_BOSS_COLLECTIONS ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    ];
  }

  function getBossCollectionKills(member, source) {
    if (!source) {
      return 0;
    }

    if (source.type === 'catacombs') {
      return Number(member?.dungeons?.dungeon_types?.catacombs?.tier_completions?.[source.floor]) || 0;
    }

    if (source.type === 'kuudra') {
      const kuudra = member?.nether_island_player_data?.kuudra_completed_tiers || {};
      return Object.entries(kuudra)
        .filter(([key]) => !key.startsWith('highest_wave_'))
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
    }

    return 0;
  }

  function getBossCollectionProgress(kills, thresholds) {
    const normalizedKills = Math.max(0, Number(kills) || 0);
    const requirementList = Array.isArray(thresholds) ? thresholds : [];
    let level = 0;

    for (const requirement of requirementList) {
      if (normalizedKills >= requirement) {
        level += 1;
      } else {
        return {
          level,
          nextRequirement: requirement,
          killsToNext: requirement - normalizedKills,
          maxed: false
        };
      }
    }

    return {
      level,
      nextRequirement: null,
      killsToNext: 0,
      maxed: true
    };
  }

  function buildBossCollectionsEmbed(playerName, profileName, member) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${playerName}'s Boss Collections on ${profileName || 'Unknown'}`)
      .setFooter({ text: 'Boss collection levels are inferred from Hypixel completion counts.' })
      .setTimestamp();

    for (const boss of BOSS_COLLECTIONS) {
      const kills = getBossCollectionKills(member, boss.killSource);
      const progress = getBossCollectionProgress(kills, boss.thresholds);
      // Field names do not render custom emojis, so the boss icon leads the value.
      embed.addFields({
        name: `${boss.label} ${progress.level}`,
        value: progress.maxed
          ? `${icon(boss.icon, boss.emoji)} ${formatNumber(kills)} kills\nMaxed`
          : `${icon(boss.icon, boss.emoji)} ${formatNumber(kills)} kills\n${boss.label} ${progress.level + 1} in ${formatNumber(progress.killsToNext)} kills`,
        inline: true
      });
    }

    return embed;
  }

  function buildCatacombsPayload(view, playerName, uuid, selectedProfile, content) {
    const selectedView = view === CATACOMBS_VIEW_BOSS_COLLECTIONS ? CATACOMBS_VIEW_BOSS_COLLECTIONS : CATACOMBS_VIEW_BASIC;
    const embed = selectedView === CATACOMBS_VIEW_BOSS_COLLECTIONS
      ? buildBossCollectionsEmbed(playerName, selectedProfile.cuteName, selectedProfile.member)
      : buildDungeonEmbed(playerName, selectedProfile.cuteName, selectedProfile.member);

    return {
      content,
      embeds: [embed],
      components: buildViewComponents(selectedView, { uuid, profileId: selectedProfile.profileId, playerName })
    };
  }

  function getCatacombsXp(entry) {
    return Number(entry.member?.dungeons?.dungeon_types?.catacombs?.experience) || 0;
  }

  // Without a requested or selected profile, show the one with the most Catacombs XP.
  function selectCatacombsProfile(profiles, uuid, options) {
    return selectProfile(profiles, uuid, {
      ...options,
      fallback: (candidates) => [...candidates].sort((left, right) => getCatacombsXp(right) - getCatacombsXp(left))[0]
    });
  }

  function buildDungeonEmbed(playerName, profileName, member) {
    const dungeons = member?.dungeons || {};
    const catacombs = dungeons.dungeon_types?.catacombs || {};
    const masterCatacombs = dungeons.dungeon_types?.master_catacombs || {};
    const classes = dungeons.player_classes || {};
    const catacombsExperience = Number(catacombs.experience) || 0;
    const secretsFound = Number(member.dungeons?.secrets ?? member.achievements?.skyblock_treasure_hunter ?? member.dungeons?.secrets_found ?? 0) || 0;
    const totalRuns = getCompletionRuns(catacombs) + getCompletionRuns(masterCatacombs);
    const selectedClass = String(dungeons.selected_dungeon_class || '').trim().toLowerCase();
    const selectedClassExperience = Number(classes?.[selectedClass]?.experience) || 0;
    const classSummary = summarizeClasses(classes);
    const maxedPercentage = (catacombsExperience / LEVEL_50_TOTAL_XP) * 100;

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${playerName}'s Catacombs on ${profileName || 'Unknown'}`)
      .setDescription([
        `${icon('dungeon_catacombs', '💀')} **Catacombs:** ${formatLevelSummary(catacombsExperience)} | ${formatCompactNumber(catacombsExperience)} XP`,
        `${icon('dungeon_secrets', '🧰')} **Secrets found:** ${formatNumber(secretsFound)}${totalRuns > 0 ? ` (Per Run: ${(secretsFound / totalRuns).toFixed(2)})` : ''}`,
        `${icon('dungeon_runs', '🏃')} **Total Runs:** ${formatNumber(totalRuns)}`,
        `${icon('dungeon_blood', '🩸')} **Blood Mob Kills:** ${formatNumber(getBloodMobKills(catacombs))}`,
        `${icon('dungeon_class', '⭐')} **Selected Class:** ${formatClassName(selectedClass)} ${formatLevelSummary(selectedClassExperience, { wholeNumber: true })}`,
        `${icon('dungeon_class_average', '📘')} **Class Average:** ${
          classSummary
            ? `${classSummary.averageBaseLevel.toFixed(1)} (${classSummary.averageOverflowLevel.toFixed(2)})`
            : 'Unknown'
        }`,
        `${buildMaxedProgressBar(maxedPercentage)} (${maxedPercentage.toFixed(1)}% of level 50 maxed)`
      ].join('\n'))
      .addFields(
        {
          name: 'Catacombs Floors',
          value: formatFloorLines('F', catacombs),
          inline: false
        },
        {
          name: 'Master Floors',
          value: formatFloorLines('M', masterCatacombs),
          inline: false
        }
      )
      .setFooter({ text: 'Data from the official Hypixel API' })
      .setTimestamp();
  }

  async function handleCatacombsCommand(interaction) {
    await interaction.deferReply();

    try {
      const { username, usedLinkedAccount } = await resolveMinecraftUsernameOption({ interaction, linkStore, optionName: 'player' });
      const requestedProfile = interaction.options.getString('profile', false)?.trim() || null;
      const { uuid, name } = await minecraft.resolvePlayerProfile(username);
      const profiles = await hypixelApi.getProfiles(uuid);
      const selectedProfile = selectCatacombsProfile(profiles, uuid, { profileName: requestedProfile });

      if (!selectedProfile) {
        throw new Error('No SkyBlock profile with dungeon data found for that player.');
      }

      await interaction.editReply(buildCatacombsPayload(
        CATACOMBS_VIEW_BASIC,
        name,
        uuid,
        selectedProfile,
        usedLinkedAccount ? buildLinkedUsernameNotice(name) : undefined
      ));
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to fetch catacombs data.'
      });
    }
  }

  async function handleCatacombsViewButton(interaction) {
    if (!interaction.isButton()) {
      return false;
    }

    const isLegacyButton = LEGACY_CATACOMBS_VIEW_BUTTON_IDS.has(interaction.customId);
    if (!isLegacyButton && !interaction.customId.startsWith(CATACOMBS_VIEW_BUTTON_PREFIX)) {
      return false;
    }

    const context = isLegacyButton ? null : parseViewButtonId(interaction.customId);
    if (!context) {
      await interaction.reply({
        content: 'This catacombs view selector has expired. Run `/cata` again.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    try {
      const profiles = await hypixelApi.getProfiles(context.uuid);
      const selectedProfile = selectCatacombsProfile(profiles, context.uuid, { profileId: context.profileId });
      if (!selectedProfile) {
        throw new Error('This SkyBlock profile is no longer available.');
      }

      await interaction.update(buildCatacombsPayload(
        context.view,
        context.playerName,
        context.uuid,
        selectedProfile,
        interaction.message.content || undefined
      ));
    } catch (error) {
      await interaction.reply({
        content: error.message || 'Failed to update the catacombs view.',
        flags: MessageFlags.Ephemeral
      });
    }

    return true;
  }

  return {
    handleCatacombsCommand,
    handleCatacombsViewButton
  };
}

module.exports = { createCatacombsFeature };
