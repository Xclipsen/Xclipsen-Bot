const { EmbedBuilder } = require('discord.js');

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

function createCatacombsFeature({ env, minecraft }) {
  async function fetchProfiles(uuid) {
    if (!env.HYPIXEL_API_KEY) {
      throw new Error('HYPIXEL_API_KEY is missing. Add it to the bot environment first.');
    }

    const response = await fetch(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid}`, {
      headers: {
        'API-Key': env.HYPIXEL_API_KEY,
        'User-Agent': 'hypixel-mayor-discord-bot/1.0.0'
      }
    });

    if (response.status === 403) {
      throw new Error('Hypixel rejected the API key for `/cata` requests.');
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Hypixel SkyBlock profiles (${response.status}).`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.cause || 'Hypixel API did not return profile data.');
    }

    return Array.isArray(data.profiles) ? data.profiles : [];
  }

  function calculateLevel(experience = 0) {
    let remaining = Math.max(0, Number(experience) || 0);
    let level = 0;

    for (let i = 1; i < CATACOMBS_XP_TABLE.length; i += 1) {
      const needed = CATACOMBS_XP_TABLE[i];
      if (remaining < needed) {
        return {
          level: Number((level + (remaining / needed)).toFixed(2)),
          progress: needed === 0 ? 0 : remaining / needed
        };
      }

      remaining -= needed;
      level = i;
    }

    return { level, progress: 1 };
  }

  function formatLevel(levelData) {
    if (!levelData) {
      return 'Unknown';
    }

    const level = typeof levelData === 'number' ? levelData : levelData.level;
    const progress = typeof levelData === 'object' ? levelData.progress : null;

    if (typeof level !== 'number' || Number.isNaN(level)) {
      return 'Unknown';
    }

    return typeof progress === 'number'
      ? `${level.toFixed(2)} (${Math.round(progress * 100)}%)`
      : level.toFixed(2);
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'Unknown';
    }

    return new Intl.NumberFormat('en-US').format(value);
  }

  function getBestProfile(profiles, uuid) {
    const candidates = profiles
      .map((profile) => {
        const member = profile?.members?.[uuid];
        const catacombsXp = member?.dungeons?.dungeon_types?.catacombs?.experience ?? 0;
        return {
          profile,
          member,
          catacombsXp
        };
      })
      .filter((entry) => entry.member);

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => right.catacombsXp - left.catacombsXp);
    return candidates[0];
  }

  function summarizeClasses(classes = {}) {
    const order = ['healer', 'mage', 'berserk', 'archer', 'tank'];

    const entries = order
      .map((name) => {
        const classData = classes[name];
        if (!classData) {
          return null;
        }

        return `**${name[0].toUpperCase()}${name.slice(1)}**: ${formatLevel(calculateLevel(classData.experience ?? 0))}`;
      })
      .filter(Boolean);

    return entries.length > 0 ? entries.join('\n') : 'No class data';
  }

  function summarizeFloors(floors = {}) {
    const keys = Object.keys(floors)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));

    if (keys.length === 0) {
      return 'No floor completions';
    }

    return keys
      .map((key) => `**F${key}**: ${formatNumber(floors[key])}`)
      .join(' | ');
  }

  function buildDungeonEmbed(playerName, profileName, member) {
    const dungeons = member?.dungeons || {};
    const catacombs = dungeons.dungeon_types?.catacombs || {};
    const masterCatacombs = dungeons.dungeon_types?.master_catacombs || {};
    const classes = dungeons.player_classes || {};

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`Catacombs Overview - ${playerName}`)
      .addFields(
        {
          name: 'Profile',
          value: profileName || 'Unknown',
          inline: true
        },
        {
          name: 'Catacombs Level',
          value: formatLevel(calculateLevel(catacombs.experience ?? 0)),
          inline: true
        },
        {
          name: 'Master Catacombs',
          value: formatLevel(calculateLevel(masterCatacombs.experience ?? 0)),
          inline: true
        },
        {
          name: 'Secrets Found',
          value: formatNumber(member.achievements?.skyblock_treasure_hunter ?? member.dungeons?.secrets_found ?? 0),
          inline: true
        },
        {
          name: 'Classes',
          value: summarizeClasses(classes),
          inline: false
        },
        {
          name: 'Catacombs Floors',
          value: summarizeFloors(catacombs.tier_completions || {}),
          inline: false
        },
        {
          name: 'Master Floors',
          value: summarizeFloors(masterCatacombs.tier_completions || {}),
          inline: false
        }
      )
      .setFooter({ text: 'Data from the official Hypixel API' })
      .setTimestamp();
  }

  async function handleCatacombsCommand(interaction) {
    const player = interaction.options.getString('player', true).trim();

    await interaction.deferReply();

    try {
      const { uuid, name } = await minecraft.resolvePlayerProfile(player);
      const profiles = await fetchProfiles(uuid);
      const bestProfile = getBestProfile(profiles, uuid);

      if (!bestProfile) {
        throw new Error('No SkyBlock profile with dungeon data found for that player.');
      }

      await interaction.editReply({
        embeds: [buildDungeonEmbed(name, bestProfile.profile?.cute_name || bestProfile.profile?.cuteName, bestProfile.member)]
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to fetch catacombs data.'
      });
    }
  }

  return {
    handleCatacombsCommand
  };
}

module.exports = { createCatacombsFeature };
