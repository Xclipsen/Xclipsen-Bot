const { ActionRowBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');
const { normalizeUuid, selectProfile } = require('../utils/hypixelApi');

const TROPHY_FISH_SELECT_ID = 'trophy-fish-select';
const TROPHY_FROG_SELECT_ID = 'trophy-frog-select';
const TROPHY_TIERS = ['bronze', 'silver', 'gold', 'diamond'];
const TROPHY_FISH_NAMES = [
  {
    key: 'blobfish',
    label: 'Blobfish',
    chance: '25% (1 in 4 rolls)',
    foundAt: 'Caught everywhere on Crimson Isle lava.',
    requirement: 'No special requirement.'
  },
  {
    key: 'sulphur_skitter',
    label: 'Sulphur Skitter',
    chance: '30% (1 in 3.33 rolls)',
    foundAt: 'Caught near Sulphur Ore on the Crimson Isle.',
    requirement: 'Stand within 4 blocks of Sulphur Ore.'
  },
  {
    key: 'flyfish',
    label: 'Flyfish',
    chance: '8% (1 in 12.5 rolls)',
    foundAt: 'Found in the Blazing Volcano.',
    requirement: 'Fish from 8 blocks or higher above lava.'
  },
  {
    key: 'golden_fish',
    label: 'Golden Fish',
    chance: 'Spawns after 8 minutes, scaling to 100% at 12 minutes.',
    foundAt: 'Found swimming around in lava.',
    requirement: 'Keep fishing continuously; the roll happens when the hook is thrown.'
  },
  {
    key: 'gusher',
    label: 'Gusher',
    chance: '20% (1 in 5 rolls)',
    foundAt: 'Found in the Blazing Volcano after an eruption.',
    requirement: 'Fish 7 to 16 minutes after a volcano eruption.'
  },
  {
    key: 'karate_fish',
    label: 'Karate Fish',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in lava pools near the Dojo.',
    requirement: 'Fish near the Dojo.'
  },
  {
    key: 'lava_horse',
    label: 'Lavahorse',
    chance: '4% (1 in 25 rolls)',
    foundAt: 'Caught everywhere on Crimson Isle lava.',
    requirement: 'No special requirement.'
  },
  {
    key: 'mana_ray',
    label: 'Mana Ray',
    chance: 'Your mana divided by 1,000.',
    foundAt: 'Can be caught anywhere while lava fishing.',
    requirement: 'Have at least 1,200 Mana.'
  },
  {
    key: 'moldfin',
    label: 'Moldfin',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in Mystic Marsh.',
    requirement: 'Fish in the Mystic Marsh area.'
  },
  {
    key: 'obfuscated_fish_1',
    label: 'Obfuscated 1',
    chance: '25% (1 in 4 rolls)',
    foundAt: 'Can be caught while using Corrupted Bait.',
    requirement: 'Use Corrupted Bait.'
  },
  {
    key: 'obfuscated_fish_2',
    label: 'Obfuscated 2',
    chance: '20% (1 in 5 rolls)',
    foundAt: 'Caught from Obfuscated 1 bait fishing.',
    requirement: 'Use Obfuscated 1 as bait.'
  },
  {
    key: 'obfuscated_fish_3',
    label: 'Obfuscated 3',
    chance: '10% (1 in 10 rolls)',
    foundAt: 'Caught from Obfuscated 2 bait fishing.',
    requirement: 'Use Obfuscated 2 as bait.'
  },
  {
    key: 'skeleton_fish',
    label: 'Skeleton Fish',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in the Burning Desert.',
    requirement: 'Fish in the Burning Desert area.'
  },
  {
    key: 'slugfish',
    label: 'Slugfish',
    chance: '15% (1 in 6.67 rolls)',
    foundAt: 'Can be caught anywhere while lava fishing.',
    requirement: 'Keep the bobber active for at least 20 seconds.'
  },
  {
    key: 'steaming_hot_flounder',
    label: 'Steaming-Hot Flounder',
    chance: '20% (1 in 5 rolls)',
    foundAt: 'Found in Volcano Geysers in the Blazing Volcano.',
    requirement: 'The bobber must be within 2 blocks of a geyser.'
  },
  {
    key: 'soul_fish',
    label: 'Soul Fish',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in the Stronghold.',
    requirement: 'Fish in the Stronghold area.'
  },
  {
    key: 'vanille',
    label: 'Vanille',
    chance: '8% (1 in 12.5 rolls)',
    foundAt: 'Can be caught while lava fishing on the Crimson Isle.',
    requirement: 'Use a Starter Lava Rod with no enchantments.'
  },
  {
    key: 'volcanic_stonefish',
    label: 'Volcanic Stonefish',
    chance: '3% (1 in 33.33 rolls)',
    foundAt: 'Found in the Blazing Volcano.',
    requirement: 'Fish in the Blazing Volcano area.'
  }
];
const TROPHY_FISH_BY_KEY = Object.fromEntries(TROPHY_FISH_NAMES.map((fish) => [fish.key, fish]));
const TROPHY_FROG_NAMES = [
  {
    key: 'common_frog',
    label: 'Common Frog',
    chance: '25% (1 in 4 rolls)',
    foundAt: 'Caught everywhere on Lotus Atoll water.',
    requirement: 'No special requirement.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'exploding_frog',
    label: 'Exploding Frog',
    chance: '100% from a lily explosion.',
    foundAt: 'Created from exploding lily pads on Lotus Atoll.',
    requirement: 'Combine lily pads until they reach size 8 and explode.',
    pity: { gold: 50, diamond: 300 }
  },
  {
    key: 'leap_frog',
    label: 'Leap Frog',
    chance: '20% (1 in 5 rolls)',
    foundAt: 'Caught while fishing on Lotus Atoll.',
    requirement: 'Be midair when the catch happens.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'wetlands_frog',
    label: 'Wetlands Frog',
    chance: '15% (1 in 6.67 rolls)',
    foundAt: 'Caught on Lotus Atoll during rain.',
    requirement: 'Fish while it is raining on Lotus Atoll.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'reality_hopper',
    label: 'Reality Hopper',
    chance: '10% (1 in 10 rolls)',
    foundAt: 'Caught in Lotus Atoll wormholes.',
    requirement: 'Fish inside a visible wormhole while wearing Froggles.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'blessed_frog',
    label: 'Blessed Frog',
    chance: '10% (1 in 10 rolls)',
    foundAt: 'Caught on Lotus Atoll after receiving a blessing.',
    requirement: 'Throw a Frogcoin into the Lotus Eater\'s Cave water and fish while the blessing is active.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'bullfrog',
    label: 'Bullfrog',
    chance: '5% (1 in 20 rolls)',
    foundAt: 'Caught on Lotus Atoll water.',
    requirement: 'Wear a Red Sweater while fishing.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'sea_frog',
    label: 'Sea Frog',
    chance: '5% (1 in 20 rolls)',
    foundAt: 'Caught on Lotus Atoll water.',
    requirement: 'Be underwater when the catch happens.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'cave_frog',
    label: 'Cave Frog',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in Lotus Eater\'s Cave.',
    requirement: 'Fish inside Lotus Eater\'s Cave.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'highlands_frog',
    label: 'Highlands Frog',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Found in Lotus Highlands.',
    requirement: 'Fish in the Lotus Highlands area.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'tree_frog',
    label: 'Tree Frog',
    chance: '2% (1 in 50 rolls)',
    foundAt: 'Caught on Lotus Atoll water.',
    requirement: 'Stand on leaves when the catch happens.',
    pity: { gold: 100, diamond: 600 }
  },
  {
    key: 'puddle_jumper',
    label: 'Puddle Jumper',
    chance: '100% from a Puddle Jumper catch.',
    foundAt: 'Drops from the Puddle Jumper sea creature on Lotus Atoll.',
    requirement: 'Fish while flying around Lotus Atoll and catch a Puddle Jumper.',
    pity: { gold: 50, diamond: 300 }
  }
];
const TROPHY_FROG_BY_KEY = Object.fromEntries(TROPHY_FROG_NAMES.map((frog) => [frog.key, frog]));
const TROPHY_FISH_RANKS = [
  { key: 'bronze', label: 'Novice Trophy Fisher', tierLabel: 'Bronze', needed: 15, requirementMode: 'partial' },
  { key: 'silver', label: 'Adept Trophy Fisher', tierLabel: 'Silver', needed: 18, requirementMode: 'all' },
  { key: 'gold', label: 'Expert Trophy Fisher', tierLabel: 'Gold', needed: 18, requirementMode: 'all' },
  { key: 'diamond', label: 'Master Trophy Fisher', tierLabel: 'Diamond', needed: 18, requirementMode: 'all' }
];
const TROPHY_FISH_DIAMOND_PITY = 600;

function formatTierLabel(tier) {
  return `${tier[0].toUpperCase()}${tier.slice(1)}`;
}

// One `Tier: value` line per trophy tier, bronze to diamond.
function formatTierLines(formatValue) {
  return TROPHY_TIERS.map((tier) => `${formatTierLabel(tier)}: ${formatValue(tier)}`);
}

function createTrophyFishingFeature({ minecraft, linkStore, hypixelApi }) {
  function formatNumber(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '0';
    }

    return new Intl.NumberFormat('en-US').format(value);
  }

  function formatCountOrMissing(count) {
    return count > 0 ? formatNumber(count) : '❌';
  }

  function formatUnlocked(unlocked) {
    return unlocked ? '✅' : '❌';
  }

  function getTierCount(trophyFish, fishKey, tier) {
    return Number(trophyFish?.[`${fishKey}_${tier}`]) || 0;
  }

  function getFishTotal(trophyFish, fishKey) {
    return Number(trophyFish?.[fishKey]) || 0;
  }

  function getTierProgressCount(trophyFish, tier) {
    return TROPHY_FISH_NAMES.filter((fish) => getTierCount(trophyFish, fish.key, tier) > 0).length;
  }

  function getCompletedTasks(member) {
    return new Set(Array.isArray(member?.leveling?.completed_tasks) ? member.leveling.completed_tasks : []);
  }

  function createTrophyFrogProgress(member) {
    return {
      completedTasks: getCompletedTasks(member),
      sacksCounts: member?.inventory?.sacks_counts && typeof member.inventory.sacks_counts === 'object'
        ? member.inventory.sacks_counts
        : {},
      totalCaught: Number(member?.player_stats?.items_fished?.trophy_frog) || 0
    };
  }

  function getTrophyTaskName(itemKey, tier) {
    return `TROPHY_${itemKey.toUpperCase()}_${tier.toUpperCase()}`;
  }

  function getHighestUnlockedTier(progress, itemKey) {
    for (let index = TROPHY_TIERS.length - 1; index >= 0; index -= 1) {
      if (progress.completedTasks.has(getTrophyTaskName(itemKey, TROPHY_TIERS[index]))) {
        return index;
      }
    }

    return -1;
  }

  function hasUnlockedTier(progress, itemKey, tier) {
    return getHighestUnlockedTier(progress, itemKey) >= TROPHY_TIERS.indexOf(tier);
  }

  function getUnlockedTierProgressCount(progress, tier) {
    return TROPHY_FROG_NAMES.filter((frog) => hasUnlockedTier(progress, frog.key, tier)).length;
  }

  function getFrogSackCount(progress, frogKey, tier) {
    return Number(progress?.sacksCounts?.[`${frogKey.toUpperCase()}_${tier.toUpperCase()}`]) || 0;
  }

  function getRewardStatus(trophyFish) {
    const progressMap = {
      ...Object.fromEntries(TROPHY_TIERS.map((tier) => [tier, getTierProgressCount(trophyFish, tier)])),
      // Bronze counts any catch of a fish, not only bronze-tier catches.
      bronze: TROPHY_FISH_NAMES.filter((fish) => getFishTotal(trophyFish, fish.key) > 0).length
    };

    for (const rank of TROPHY_FISH_RANKS) {
      const progress = progressMap[rank.key];
      const target = rank.needed;
      if (progress < target) {
        return `${rank.label} (${rank.tierLabel}) ${progress}/${target}`;
      }
    }

    return `Master Trophy Fisher (Diamond) 18/18`;
  }

  function createFishOverviewField(trophyFish, fish) {
    const diamond = getTierCount(trophyFish, fish.key, 'diamond');
    const total = getFishTotal(trophyFish, fish.key);

    return {
      name: fish.label,
      value: [
        ...formatTierLines((tier) => formatCountOrMissing(getTierCount(trophyFish, fish.key, tier))),
        `Total: ${formatNumber(total)}`,
        diamond === 0 ? `${formatNumber(Math.max(0, TROPHY_FISH_DIAMOND_PITY - total))} until guaranteed Diamond!` : null
      ].filter(Boolean).join('\n'),
      inline: true
    };
  }

  function buildFishOverviewEmbed(playerName, profileName, member) {
    const trophyFish = member?.trophy_fish || {};
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${playerName}'s Trophy Fish on ${profileName || 'Unknown'}`)
      .setDescription([
        `Reward Status: ${getRewardStatus(trophyFish)}`,
        `Total Trophy Fish Caught: ${formatNumber(Number(trophyFish?.total_caught) || 0)}`
      ].join('\n'))
      .setFooter({ text: 'Data from the official Hypixel API. Fish requirements from the Hypixel Wiki.' })
      .setTimestamp();

    for (const fish of TROPHY_FISH_NAMES) {
      embed.addFields(createFishOverviewField(trophyFish, fish));
    }

    return embed;
  }

  function buildFrogOverviewEmbed(playerName, profileName, member) {
    const progress = createTrophyFrogProgress(member);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${playerName}'s Trophy Frogs on ${profileName || 'Unknown'}`)
      .setDescription([
        ...TROPHY_TIERS.map((tier) => `${formatTierLabel(tier)} Progress: ${getUnlockedTierProgressCount(progress, tier)}/${TROPHY_FROG_NAMES.length}`),
        `Total Trophy Frogs Caught: ${formatNumber(progress.totalCaught)}`
      ].join('\n'))
      .setFooter({ text: 'Hypixel only exposes total frog catches plus unlocked tiers right now. Requirements from the Hypixel SkyBlock Wiki.' })
      .setTimestamp();

    for (const frog of TROPHY_FROG_NAMES) {
      embed.addFields({
        name: frog.label,
        value: formatTierLines((tier) => formatUnlocked(hasUnlockedTier(progress, frog.key, tier))).join('\n'),
        inline: true
      });
    }

    return embed;
  }

  function buildFishInfoEmbed(fish, member) {
    const trophyFish = member?.trophy_fish || {};
    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(fish.label)
      .setDescription([
        `Chance: ${fish.chance}`,
        fish.foundAt,
        `Requirement: ${fish.requirement}`
      ].join('\n\n'))
      .addFields({
        name: 'Your Counts',
        value: [
          ...formatTierLines((tier) => formatCountOrMissing(getTierCount(trophyFish, fish.key, tier))),
          `Total: ${formatNumber(getFishTotal(trophyFish, fish.key))}`
        ].join('\n'),
        inline: false
      });
  }

  function buildFrogInfoEmbed(frog, member) {
    const progress = createTrophyFrogProgress(member);
    const hasTrackedSackCounts = TROPHY_TIERS.some((tier) => getFrogSackCount(progress, frog.key, tier) > 0);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(frog.label)
      .setDescription([
        `Chance: ${frog.chance}`,
        frog.foundAt,
        `Requirement: ${frog.requirement}`
      ].join('\n\n'))
      .setFooter({ text: 'The official Hypixel API does not expose full per-frog catch totals yet.' });

    embed.addFields(
      {
        name: 'Your Progress',
        value: formatTierLines((tier) => formatUnlocked(hasUnlockedTier(progress, frog.key, tier))).join('\n'),
        inline: true
      },
      {
        name: 'Pity',
        value: [
          `Gold guaranteed after ${formatNumber(frog.pity.gold)} catches if still missing.`,
          `Diamond guaranteed after ${formatNumber(frog.pity.diamond)} catches if still missing.`
        ].join('\n'),
        inline: true
      }
    );

    if (hasTrackedSackCounts) {
      embed.addFields({
        name: 'Currently In Sack',
        value: formatTierLines((tier) => formatNumber(getFrogSackCount(progress, frog.key, tier))).join('\n'),
        inline: false
      });
    }

    return embed;
  }

  const VIEWS = {
    fish: {
      selectId: TROPHY_FISH_SELECT_ID,
      items: TROPHY_FISH_NAMES,
      itemsByKey: TROPHY_FISH_BY_KEY,
      command: '/trophyfishing',
      placeholder: 'View fish information',
      unknownItem: 'That trophy fish is not available.',
      failure: 'Failed to fetch trophy fishing data.',
      buildOverview: buildFishOverviewEmbed,
      buildInfo: buildFishInfoEmbed
    },
    frog: {
      selectId: TROPHY_FROG_SELECT_ID,
      items: TROPHY_FROG_NAMES,
      itemsByKey: TROPHY_FROG_BY_KEY,
      command: '/trophyfrogs',
      placeholder: 'View frog information',
      unknownItem: 'That trophy frog is not available.',
      failure: 'Failed to fetch trophy frog data.',
      buildOverview: buildFrogOverviewEmbed,
      buildInfo: buildFrogInfoEmbed
    }
  };

  // The select id carries `<select id>:<uuid>:<profile id>` so the info view survives restarts.
  function buildInfoSelect(view, uuid, profileId) {
    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${view.selectId}:${normalizeUuid(uuid)}:${normalizeUuid(profileId)}`)
          .setPlaceholder(view.placeholder)
          .addOptions(
            view.items.map((item) => ({
              label: item.label,
              value: item.key,
              description: item.foundAt.slice(0, 100)
            }))
          )
      )
    ];
  }

  async function handleOverviewCommand(interaction, view) {
    await interaction.deferReply();

    try {
      const { username, usedLinkedAccount } = await resolveMinecraftUsernameOption({ interaction, linkStore, optionName: 'player' });
      const requestedProfile = interaction.options.getString('profile', false)?.trim() || null;
      const { uuid, name } = await minecraft.resolvePlayerProfile(username);
      const profiles = await hypixelApi.getProfiles(uuid);
      const selectedProfile = selectProfile(profiles, uuid, { profileName: requestedProfile });

      if (!selectedProfile) {
        throw new Error('No SkyBlock profile found for that player.');
      }

      await interaction.editReply({
        content: usedLinkedAccount ? buildLinkedUsernameNotice(name) : undefined,
        embeds: [view.buildOverview(name, selectedProfile.cuteName, selectedProfile.member)],
        components: buildInfoSelect(view, uuid, selectedProfile.profileId)
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || view.failure
      });
    }
  }

  async function handleInfoSelect(interaction, view) {
    if (!interaction.isStringSelectMenu()
      || (interaction.customId !== view.selectId && !interaction.customId.startsWith(`${view.selectId}:`))) {
      return false;
    }

    const item = view.itemsByKey[interaction.values[0]];
    if (!item) {
      await interaction.reply({
        content: view.unknownItem,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const [, uuid, profileId] = interaction.customId.split(':');
    if (!uuid || !profileId) {
      // Selects from older bot versions only had the plain id.
      await interaction.reply({
        content: `This selector has expired. Run \`${view.command}\` again.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const selectedProfile = selectProfile(await hypixelApi.getProfiles(uuid), uuid, { profileId });
      if (!selectedProfile) {
        throw new Error('This SkyBlock profile is no longer available.');
      }

      await interaction.editReply({ embeds: [view.buildInfo(item, selectedProfile.member)] });
    } catch (error) {
      await interaction.editReply({ content: error.message || view.failure });
    }
    return true;
  }

  return {
    handleTrophyFishingCommand: (interaction) => handleOverviewCommand(interaction, VIEWS.fish),
    handleTrophyFrogsCommand: (interaction) => handleOverviewCommand(interaction, VIEWS.frog),
    handleTrophyFishSelect: (interaction) => handleInfoSelect(interaction, VIEWS.fish),
    handleTrophyFrogSelect: (interaction) => handleInfoSelect(interaction, VIEWS.frog)
  };
}

module.exports = { createTrophyFishingFeature };
