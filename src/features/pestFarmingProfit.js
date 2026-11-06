const { EmbedBuilder } = require('discord.js');

const {
  PESTS,
  INSTA_SELL,
  SELL_ORDER,
  NPC_SELL,
  SELL_METHOD_LABELS,
  calculateValuePerKill,
  isPestEradicatorActive,
  getBazaarUnitPrice,
  formatCoins,
  formatRareDropBonus
} = require('./bestPest');

const BASE_PEST_COOLDOWN_SECONDS = 300;
const FULL_PEST_HUNTER_CDR = 0.55;
const FINNEGAN_COOLDOWN_REDUCTION = 0.2;
const EXPECTED_CROPS_PER_PEST_ROLL = 500;
const ASSUMED_PEST_FARM_CROPS_PER_SECOND = 20;
const DEFAULT_PEST_FORTUNE_DELTA = 300;
const BAIT_PEST_WEIGHT = 12;
const VINYL_PEST_WEIGHT = 3;
const BASE_CROP_BREAKS_PER_HOUR_PER_PLOT = 66320;
const KILL_SECONDS_PER_PEST = 4.628140703517589;
const BAITS_PER_PLOT_PER_HOUR = 2;

const REFORGE_OPTIONS = {
  blessed: {
    label: 'Blessed',
    coinsPerCrop: 0
  },
  bountiful: {
    label: 'Bountiful',
    coinsPerCrop: 0.2
  }
};

const BAITS = [
  { key: 'dung', label: 'Dung (Fly + Beetle)', itemLabel: 'Dung', productId: 'DUNG', pestKeys: ['fly', 'beetle'] },
  { key: 'honey_jar', label: 'Honey Jar (Cricket + Moth)', itemLabel: 'Honey Jar', productId: 'HONEY_JAR', pestKeys: ['cricket', 'moth'] },
  { key: 'plant_matter', label: 'Plant Matter (Slug + Locust)', itemLabel: 'Plant Matter', productId: 'PLANT_MATTER', pestKeys: ['slug', 'locust'] },
  { key: 'tasty_cheese', label: 'Tasty Cheese (Rat + Mite)', itemLabel: 'Tasty Cheese', productId: 'CHEESEBITE', pestKeys: ['rat', 'mite'] },
  { key: 'compost', label: 'Compost (Mosquito + Earthworm)', itemLabel: 'Compost', productId: 'COMPOST', pestKeys: ['mosquito', 'earthworm'] },
  { key: 'jelly', label: 'Jelly (Dragonfly + Firefly + Praying Mantis)', itemLabel: 'Jelly', productId: 'WARTY', pestKeys: ['dragonfly', 'firefly', 'praying_mantis'] }
];

const CROPS = [
  { key: 'melon', label: 'Melon', npcUnitPrice: 2, components: [{ type: 'direct', productId: 'MELON', amount: 1 }] },
  { key: 'sugar_cane', label: 'Sugar Cane', npcUnitPrice: 4, components: [{ type: 'direct', productId: 'SUGAR_CANE', amount: 1 }] },
  { key: 'pumpkin', label: 'Pumpkin', npcUnitPrice: 10, components: [{ type: 'direct', productId: 'PUMPKIN', amount: 1 }] },
  { key: 'carrot', label: 'Carrot', npcUnitPrice: 3, components: [{ type: 'direct', productId: 'CARROT_ITEM', amount: 1 }] },
  { key: 'potato', label: 'Potato', npcUnitPrice: 3, components: [{ type: 'direct', productId: 'POTATO_ITEM', amount: 1 }] },
  { key: 'cocoa_beans', label: 'Cocoa Beans', npcUnitPrice: 3, components: [{ type: 'derived', productId: 'ENCHANTED_COCOA', divisor: 160, amount: 1 }] },
  { key: 'mushroom', label: 'Mushroom', npcUnitPrice: 5, components: [
    { type: 'direct', productId: 'RED_MUSHROOM', amount: 0.5 },
    { type: 'direct', productId: 'BROWN_MUSHROOM', amount: 0.5 }
  ] },
  { key: 'cactus', label: 'Cactus', npcUnitPrice: 4, components: [{ type: 'direct', productId: 'CACTUS', amount: 1 }] },
  { key: 'nether_wart', label: 'Nether Wart', npcUnitPrice: 3, components: [{ type: 'direct', productId: 'NETHER_STALK', amount: 1 }] },
  { key: 'wheat', label: 'Wheat', npcUnitPrice: 6, components: [{ type: 'direct', productId: 'WHEAT', amount: 1 }] },
  { key: 'moonflower', label: 'Moonflower', npcUnitPrice: null, components: [{ type: 'direct', productId: 'MOONFLOWER', amount: 1 }] },
  { key: 'sunflower', label: 'Sunflower', npcUnitPrice: null, components: [{ type: 'derived', productId: 'ENCHANTED_SUNFLOWER', divisor: 160, amount: 1 }] },
  { key: 'wild_rose', label: 'Wild Rose', npcUnitPrice: null, components: [{ type: 'direct', productId: 'WILD_ROSE', amount: 1 }] }
];

const BAIT_BY_KEY = Object.fromEntries(BAITS.map((bait) => [bait.key, bait]));
const CROP_BY_KEY = Object.fromEntries(CROPS.map((crop) => [crop.key, crop]));
const PEST_BY_KEY = Object.fromEntries(PESTS.map((pest) => [pest.key, pest]));

function createPestFarmingProfitFeature({ store, hypixelApi }) {
  function resolveCropUnitValue(products, crop, sellMethod) {
    if (sellMethod === NPC_SELL && Number.isFinite(crop.npcUnitPrice)) {
      return crop.npcUnitPrice;
    }

    return crop.components.reduce((sum, component) => {
      const price = getBazaarUnitPrice(products, component.productId, sellMethod === NPC_SELL ? INSTA_SELL : sellMethod);
      if (price == null) {
        return sum;
      }

      if (component.type === 'derived') {
        return sum + ((price / component.divisor) * (component.amount || 1));
      }

      return sum + (price * (component.amount || 1));
    }, 0);
  }

  function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value) || 0);
  }

  function getPestsPerSpawn(bonusPestChance) {
    return 1 + (Math.max(0, Number(bonusPestChance) || 0) / 100);
  }

  function getEffectiveCooldownSeconds(finneganEnabled) {
    const reduction = FULL_PEST_HUNTER_CDR + (finneganEnabled ? FINNEGAN_COOLDOWN_REDUCTION : 0);
    return Math.max(1, BASE_PEST_COOLDOWN_SECONDS * (1 - reduction));
  }

  function getExpectedAdditionalSpawnDelaySeconds() {
    return EXPECTED_CROPS_PER_PEST_ROLL / ASSUMED_PEST_FARM_CROPS_PER_SECOND;
  }

  function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = Math.round(totalSeconds % 60);

    if (minutes <= 0) {
      return `${remainingSeconds}s`;
    }

    return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
  }

  function getPestWeights(bait, vinylKey) {
    return PESTS.map((pest) => {
      let weight = 1;
      if (bait.pestKeys.includes(pest.key)) {
        weight *= BAIT_PEST_WEIGHT;
      }
      if (pest.key === vinylKey) {
        weight *= VINYL_PEST_WEIGHT;
      }

      return {
        pest,
        weight
      };
    });
  }

  function getStoredFarmingStatsOrThrow(discordUserId) {
    const stats = store.getUserFarmingStats(discordUserId);
    if (!stats || !stats.reforge) {
      throw new Error('You need to set your farming stats first using `/setfarmingstats`.');
    }

    return stats;
  }

  function resolvePestFarmingInputOrThrow(rawInput) {
    const fortune = Math.max(0, Number(rawInput?.fortune) || 0);
    const pestFortune = Math.max(0, Number(rawInput?.pestFortune) || Math.max(0, fortune - DEFAULT_PEST_FORTUNE_DELTA));
    const plots = Math.max(1, Number(rawInput?.plots) || 0);
    const bait = BAIT_BY_KEY[String(rawInput?.bait || '').trim()];
    const vinyl = PEST_BY_KEY[String(rawInput?.vinyl || '').trim()];
    const crop = CROP_BY_KEY[String(rawInput?.crop || '').trim()];
    const sellMethod = String(rawInput?.sellMethod || '').trim();

    if (!bait || !vinyl || !crop || !Number.isFinite(fortune) || !Number.isFinite(plots) || !sellMethod) {
      throw new Error('No previous pest farming setup found. Run `/pestfarmingprofits` first.');
    }

    return {
      fortune,
      pestFortune,
      plots,
      bait,
      vinyl,
      crop,
      sellMethod
    };
  }

  function buildFarmingStatsEmbed(stats) {
    const reforge = REFORGE_OPTIONS[stats.reforge] || REFORGE_OPTIONS.blessed;

    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Your Farming Stats')
      .setDescription('Your farming stats have been updated and saved in the database:')
      .addFields(
        {
          name: 'Bonus Pest Chance',
          value: formatNumber(stats.bonusPestChance),
          inline: true
        },
        {
          name: 'Pest Shard Level',
          value: `${formatNumber(stats.pestShardLevel)} (${formatRareDropBonus(stats.pestShardLevel)})`,
          inline: true
        },
        {
          name: 'Cropeetle Level',
          value: `${formatNumber(stats.cropeetleLevel)} (+${formatNumber(stats.cropeetleLevel * 2)}%)`,
          inline: true
        },
        {
          name: 'Rarefinder Level',
          value: `${formatNumber(stats.rarefinderLevel)} (+${formatNumber(stats.rarefinderLevel)}%)`,
          inline: true
        },
        {
          name: 'Reforge',
          value: reforge.label === 'Bountiful'
            ? `${reforge.label} (+${reforge.coinsPerCrop.toFixed(1)} coins/crop)`
            : reforge.label,
          inline: true
        }
      )
      .setTimestamp();
  }

  function buildProfitEmbed({
    fortune,
    plots,
    bait,
    vinyl,
    crop,
    sellMethod,
    finneganEnabled,
    stats,
    pestsPerHour,
    baitCostPerHour,
    grossCropProfitPerHour,
    cropProfitPerHour,
    uptimeMultiplier,
    averageSpawnTimeSeconds,
    pestProfitPerHour,
    netProfitPerHour,
    topPests,
    pestFortune
  }) {
    const reforge = REFORGE_OPTIONS[stats.reforge] || REFORGE_OPTIONS.blessed;
    const description = [
      `**Farming Fortune:** ${formatNumber(fortune)}`,
      `**Plots:** ${formatNumber(plots)}`,
      `**Crop:** ${crop.label}`,
      `**Bait:** ${bait.itemLabel}`,
      `**Vinyl:** ${vinyl.label}`,
      `**Sell Method:** ${SELL_METHOD_LABELS[sellMethod] || sellMethod}`,
      `**Mayor Finnegan:** ${finneganEnabled ? 'Enabled' : 'Disabled'}`,
      `**Bonus Pest Chance:** ${formatNumber(stats.bonusPestChance)}`,
      `**Pest Shard Level:** ${formatNumber(stats.pestShardLevel)} (${formatRareDropBonus(stats.pestShardLevel)})`,
      `**Reforge:** ${reforge.label}`,
      `**Average Time to Spawn:** ${formatDuration(averageSpawnTimeSeconds)}`,
      '',
      `**Pests per Hour:** ${formatNumber(pestsPerHour, 1)}`,
      `**Bait Cost per Hour:** ${formatCoins(baitCostPerHour)}`,
      `**Crop Profit per Hour:** ${formatCoins(grossCropProfitPerHour)} × ${uptimeMultiplier.toFixed(3)} = ${formatCoins(cropProfitPerHour)}`,
      `**Pest Profit per Hour:** ${formatCoins(pestProfitPerHour)}`,
      `**Net Profit per Hour:** ${formatCoins(netProfitPerHour)}`,
      '',
      '**Top Pests by Profit**',
      ...topPests.map((entry) => (
        `**${entry.pest.label}** (${entry.share.toFixed(2)}%)\n↳ ${formatNumber(entry.pestsPerHour, 1)}/hr × ${formatCoins(entry.valuePerKill)} = ${formatCoins(entry.profitPerHour)}/hr`
      ))
    ];

    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Pest Farming Profit Calculator')
      .setDescription(description.join('\n'))
      .setFooter({
        text: `Calculated with ${formatNumber(pestsPerHour, 0)} total pests/hr • Pests use ${formatNumber(pestFortune)} fortune`
      })
      .setTimestamp();
  }

  async function handleSetFarmingStatsCommand(interaction) {
    // Cropeetle and Rarefinder are optional and only echoed; omitted values keep the saved level.
    const optionalLevels = Object.fromEntries(
      [['cropeetleLevel', 'cropeetle_level'], ['rarefinderLevel', 'rarefinder_level']]
        .map(([key, optionName]) => [key, interaction.options.getInteger(optionName, false)])
        .filter(([, value]) => value != null)
    );
    const nextStats = store.setUserFarmingStats(interaction.user.id, {
      bonusPestChance: interaction.options.getInteger('bonus_pest_chance', true),
      pestShardLevel: interaction.options.getInteger('pest_shard_level', true),
      ...optionalLevels,
      reforge: interaction.options.getString('reforge', true)
    });

    await interaction.reply({
      embeds: [buildFarmingStatsEmbed(nextStats)]
    });
  }

  async function computeProfit(stats, input) {
    const { fortune, pestFortune, plots, bait, vinyl, crop, sellMethod } = input;
    const [products, electionState] = await Promise.all([
      hypixelApi.getBazaar(),
      hypixelApi.getElection()
    ]);
    const finneganEnabled = isPestEradicatorActive(electionState);

    const effectiveCooldownSeconds = getEffectiveCooldownSeconds(finneganEnabled);
    const averageSpawnTimeSeconds = effectiveCooldownSeconds + getExpectedAdditionalSpawnDelaySeconds();
    const pestsPerSpawn = getPestsPerSpawn(stats.bonusPestChance);
    const eventsPerHour = 3600 / averageSpawnTimeSeconds;
    const pestsPerHour = eventsPerHour * pestsPerSpawn;
    const baitCostPerHour = (getBazaarUnitPrice(products, bait.productId, SELL_ORDER) || 0) * plots * BAITS_PER_PLOT_PER_HOUR;
    const cropUnitValue = resolveCropUnitValue(products, crop, sellMethod);
    const reforgeBonus = REFORGE_OPTIONS[stats.reforge]?.coinsPerCrop || 0;
    const grossCropProfitPerHour = plots * BASE_CROP_BREAKS_PER_HOUR_PER_PLOT * (1 + (fortune / 100)) * (cropUnitValue + reforgeBonus);
    const uptimeMultiplier = Math.max(0, 1 - ((pestsPerHour * KILL_SECONDS_PER_PEST) / 3600));
    const cropProfitPerHour = grossCropProfitPerHour * uptimeMultiplier;

    const weights = getPestWeights(bait, vinyl.key);
    const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
    const pestBreakdown = weights.map((entry) => {
      const valuePerKill = calculateValuePerKill(pestFortune, entry.pest, sellMethod, stats.pestShardLevel, products);
      const share = entry.weight / totalWeight;
      const pestRate = pestsPerHour * share;
      return {
        pest: entry.pest,
        share: share * 100,
        pestsPerHour: pestRate,
        valuePerKill,
        profitPerHour: pestRate * valuePerKill
      };
    });

    pestBreakdown.sort((left, right) => right.profitPerHour - left.profitPerHour || left.pest.label.localeCompare(right.pest.label));

    const pestProfitPerHour = pestBreakdown.reduce((sum, entry) => sum + entry.profitPerHour, 0);
    const netProfitPerHour = cropProfitPerHour + pestProfitPerHour - baitCostPerHour;

    return buildProfitEmbed({
      ...input,
      finneganEnabled,
      stats,
      pestsPerHour,
      baitCostPerHour,
      grossCropProfitPerHour,
      cropProfitPerHour,
      uptimeMultiplier,
      averageSpawnTimeSeconds,
      pestProfitPerHour,
      netProfitPerHour,
      topPests: pestBreakdown.slice(0, 5)
    });
  }

  async function handlePestFarmingProfitsCommand(interaction) {
    await interaction.deferReply();

    try {
      const stats = getStoredFarmingStatsOrThrow(interaction.user.id);
      const input = resolvePestFarmingInputOrThrow({
        fortune: interaction.options.getInteger('fortune', true),
        pestFortune: interaction.options.getInteger('pest_fortune', false),
        plots: interaction.options.getInteger('plots', true),
        bait: interaction.options.getString('bait', true),
        vinyl: interaction.options.getString('vinyl', true),
        crop: interaction.options.getString('crop', true),
        sellMethod: interaction.options.getString('sell_method', true)
      });

      await interaction.editReply({ embeds: [await computeProfit(stats, input)] });

      store.setUserLastPestFarmingProfits(interaction.user.id, {
        bait: input.bait.key,
        vinyl: input.vinyl.key,
        crop: input.crop.key,
        fortune: input.fortune,
        pestFortune: input.pestFortune,
        plots: input.plots,
        sellMethod: input.sellMethod
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to calculate pest farming profit.'
      });
    }
  }

  async function handleLastPestFarmingProfitsCommand(interaction) {
    await interaction.deferReply();

    try {
      const stats = getStoredFarmingStatsOrThrow(interaction.user.id);
      const input = resolvePestFarmingInputOrThrow(store.getUserLastPestFarmingProfits(interaction.user.id));
      await interaction.editReply({ embeds: [await computeProfit(stats, input)] });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to recalculate pest farming profit.'
      });
    }
  }

  return {
    handleSetFarmingStatsCommand,
    handlePestFarmingProfitsCommand,
    handleLastPestFarmingProfitsCommand
  };
}

module.exports = { createPestFarmingProfitFeature, BAITS, CROPS, REFORGE_OPTIONS };
