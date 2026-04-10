const { EmbedBuilder } = require('discord.js');

const {
  PESTS,
  INSTA_SELL,
  SELL_ORDER,
  NPC_SELL,
  SELL_METHOD_LABELS,
  PEST_ERADICATOR_NAME
} = require('./bestPest');

const BAZAAR_CACHE_TTL_MS = 60 * 1000;
const ELECTION_CACHE_TTL_MS = 60 * 1000;
const BASE_PEST_COOLDOWN_SECONDS = 300;
const SPRAYONATOR_COOLDOWN_REDUCTION = 0.5;
const FINNEGAN_COOLDOWN_REDUCTION = 0.2;
const BAIT_PEST_WEIGHT = 12;
const VINYL_PEST_WEIGHT = 3;
const NON_BAIT_FORTUNE_DELTA = 275;
const BASE_GUARANTEED_COINS = 1000;
const REFERENCE_FORTUNE = 2500;
const CALIBRATED_PEST_SHARD_RARE_BONUS_PER_LEVEL = 0.015;
const BASE_CROP_BREAKS_PER_HOUR_PER_PLOT = 66320;
const KILL_SECONDS_PER_PEST = 4.628140703517589;

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

let cachedBazaarProducts = null;
let cachedBazaarFetchedAt = 0;
let cachedElectionState = null;
let cachedElectionFetchedAt = 0;

function createPestFarmingProfitFeature({ env, store }) {
  function normalizeText(value) {
    return String(value || '')
      .replace(/§./g, '')
      .replace(/☘/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchBazaarProducts() {
    if (cachedBazaarProducts && (Date.now() - cachedBazaarFetchedAt) < BAZAAR_CACHE_TTL_MS) {
      return cachedBazaarProducts;
    }

    const response = await fetch('https://api.hypixel.net/v2/skyblock/bazaar', {
      headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' }
    });

    if (!response.ok) {
      throw new Error(`Hypixel Bazaar API responded with ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success || !data.products) {
      throw new Error('Hypixel Bazaar API response did not contain product data.');
    }

    cachedBazaarProducts = data.products;
    cachedBazaarFetchedAt = Date.now();
    return cachedBazaarProducts;
  }

  async function fetchElectionState() {
    if (cachedElectionState && (Date.now() - cachedElectionFetchedAt) < ELECTION_CACHE_TTL_MS) {
      return cachedElectionState;
    }

    const response = await fetch(env.ELECTION_URL, {
      headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' }
    });

    if (!response.ok) {
      throw new Error(`Hypixel Election API responded with ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success || !data.mayor) {
      throw new Error('Hypixel Election API response did not contain mayor data.');
    }

    cachedElectionState = data;
    cachedElectionFetchedAt = Date.now();
    return cachedElectionState;
  }

  async function isPestEradicatorActive() {
    const electionState = await fetchElectionState();
    const mayor = electionState?.mayor || null;
    const normalizedMayorKey = String(mayor?.key || '').toLowerCase();
    const normalizedMayorName = String(mayor?.name || '').toLowerCase();
    const normalizedMayorPerks = Array.isArray(mayor?.perks)
      ? mayor.perks.map((perk) => normalizeText(perk?.name))
      : [];
    const ministerPerkName = normalizeText(mayor?.minister?.perk?.name);

    return (
      (
        (normalizedMayorKey === 'finnegan' || normalizedMayorName === 'finnegan')
        && normalizedMayorPerks.includes(PEST_ERADICATOR_NAME)
      )
      || ministerPerkName === PEST_ERADICATOR_NAME
    );
  }

  function calculateGuaranteedAmount(fortune, guaranteed) {
    const normalizedFortune = Math.max(0, Number(fortune) || 0);
    const scaledAmount = guaranteed.scaling > 0 ? normalizedFortune / guaranteed.scaling : 0;
    return Math.max(guaranteed.baseAmount, scaledAmount);
  }

  function calculateGuaranteedNpcValue(fortune, pest) {
    return (calculateGuaranteedAmount(fortune, pest.guaranteed) * pest.guaranteed.unitNpcValue) + BASE_GUARANTEED_COINS;
  }

  function calculateRareScaling(fortune) {
    return (1 + (Math.max(0, Number(fortune) || 0) / 600)) / (1 + (REFERENCE_FORTUNE / 600));
  }

  function calculateNpcValuePerKill(fortune, pest, rareMultiplier = 1) {
    const guaranteedValue = calculateGuaranteedNpcValue(fortune, pest);
    const guaranteedAtReference = calculateGuaranteedNpcValue(REFERENCE_FORTUNE, pest);
    const referenceRareValue = Math.max(0, pest.targetNpcAt2500 - guaranteedAtReference);
    const scaledRareValue = referenceRareValue * calculateRareScaling(fortune) * rareMultiplier;
    return guaranteedValue + scaledRareValue;
  }

  function getProductUnitPrice(products, productId, method) {
    const product = products?.[productId];
    if (!product?.quick_status) {
      return null;
    }

    if (method === SELL_ORDER) {
      return Number(product.quick_status.buyPrice) || 0;
    }

    return Number(product.quick_status.sellPrice) || 0;
  }

  function calculateGuaranteedMarketValue(fortune, pest, products, method) {
    const amount = calculateGuaranteedAmount(fortune, pest.guaranteed);
    const bundle = Array.isArray(pest.guaranteed.marketBundle) ? pest.guaranteed.marketBundle : [];

    if (bundle.length === 0) {
      return calculateGuaranteedNpcValue(fortune, pest);
    }

    const bundleUnitValue = bundle.reduce((sum, component) => {
      const price = getProductUnitPrice(products, component.productId, method);
      if (price == null) {
        return sum;
      }

      return sum + (price * (component.amount || 1));
    }, 0);

    if (bundleUnitValue <= 0) {
      return calculateGuaranteedNpcValue(fortune, pest);
    }

    return (amount * bundleUnitValue) + BASE_GUARANTEED_COINS;
  }

  async function calculatePestValuePerKill(fortune, pest, sellMethod, pestShardLevel) {
    const calibratedRareMultiplier = 1 + (Math.max(0, Number(pestShardLevel) || 0) * CALIBRATED_PEST_SHARD_RARE_BONUS_PER_LEVEL);

    if (sellMethod === NPC_SELL) {
      return calculateNpcValuePerKill(fortune, pest, calibratedRareMultiplier);
    }

    const products = await fetchBazaarProducts();
    const baselineNpcValue = calculateNpcValuePerKill(fortune, pest, calibratedRareMultiplier);
    const baselineNpcGuaranteedValue = calculateGuaranteedNpcValue(fortune, pest);
    const marketGuaranteedValue = calculateGuaranteedMarketValue(fortune, pest, products, sellMethod);
    return baselineNpcValue - baselineNpcGuaranteedValue + marketGuaranteedValue;
  }

  function resolveCropUnitValue(products, crop, sellMethod) {
    if (sellMethod === NPC_SELL && Number.isFinite(crop.npcUnitPrice)) {
      return crop.npcUnitPrice;
    }

    return crop.components.reduce((sum, component) => {
      const price = getProductUnitPrice(products, component.productId, sellMethod === NPC_SELL ? INSTA_SELL : sellMethod);
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

  function formatCoins(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1000000) {
      return `${(number / 1000000).toFixed(2)}M`;
    }

    if (number >= 1000) {
      return `${(number / 1000).toFixed(2)}K`;
    }

    return number.toFixed(0);
  }

  function getPestsPerSpawn(bonusPestChance) {
    return 1 + (Math.max(0, Number(bonusPestChance) || 0) / 100);
  }

  function getEffectiveCooldownSeconds(finneganEnabled) {
    const reduction = SPRAYONATOR_COOLDOWN_REDUCTION + (finneganEnabled ? FINNEGAN_COOLDOWN_REDUCTION : 0);
    return Math.max(1, BASE_PEST_COOLDOWN_SECONDS * (1 - reduction));
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
          value: `${formatNumber(stats.pestShardLevel)} (+${formatNumber(stats.pestShardLevel * 2)}% rare drops)`,
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
    pestProfitPerHour,
    netProfitPerHour,
    topPests,
    nonBaitFortune
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
      `**Pest Shard Level:** ${formatNumber(stats.pestShardLevel)} (+${formatNumber(stats.pestShardLevel * 2)}% rare drops)`,
      `**Reforge:** ${reforge.label}`,
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
        text: `Calculated with ${formatNumber(pestsPerHour, 0)} total pests/hr • Non-bait pests use ${formatNumber(nonBaitFortune)} fortune`
      })
      .setTimestamp();
  }

  async function handleSetFarmingStatsCommand(interaction) {
    const nextStats = store.setUserFarmingStats(interaction.user.id, {
      bonusPestChance: interaction.options.getInteger('bonus_pest_chance', true),
      pestShardLevel: interaction.options.getInteger('pest_shard_level', true),
      cropeetleLevel: interaction.options.getInteger('cropeetle_level', true),
      rarefinderLevel: interaction.options.getInteger('rarefinder_level', true),
      reforge: interaction.options.getString('reforge', true)
    });

    await interaction.reply({
      embeds: [buildFarmingStatsEmbed(nextStats)]
    });
  }

  async function handlePestFarmingProfitsCommand(interaction) {
    await interaction.deferReply();

    try {
      const stats = getStoredFarmingStatsOrThrow(interaction.user.id);
      const fortune = interaction.options.getInteger('fortune', true);
      const plots = interaction.options.getInteger('plots', true);
      const bait = BAIT_BY_KEY[interaction.options.getString('bait', true)];
      const vinyl = PEST_BY_KEY[interaction.options.getString('vinyl', true)];
      const crop = CROP_BY_KEY[interaction.options.getString('crop', true)];
      const sellMethod = interaction.options.getString('sell_method', true);

      if (!bait || !vinyl || !crop) {
        throw new Error('One or more selected options are invalid.');
      }

      const [products, finneganEnabled] = await Promise.all([
        fetchBazaarProducts(),
        isPestEradicatorActive()
      ]);

      const effectiveCooldownSeconds = getEffectiveCooldownSeconds(finneganEnabled);
      const pestsPerSpawn = getPestsPerSpawn(stats.bonusPestChance);
      const eventsPerHour = 3600 / effectiveCooldownSeconds;
      const pestsPerHour = eventsPerHour * pestsPerSpawn;
      const baitCostPerHour = (getProductUnitPrice(products, bait.productId, SELL_ORDER) || 0) * plots * 2;
      const nonBaitFortune = Math.max(0, fortune - NON_BAIT_FORTUNE_DELTA);
      const cropUnitValue = resolveCropUnitValue(products, crop, sellMethod);
      const reforgeBonus = REFORGE_OPTIONS[stats.reforge]?.coinsPerCrop || 0;
      const grossCropProfitPerHour = plots * BASE_CROP_BREAKS_PER_HOUR_PER_PLOT * (1 + (fortune / 100)) * (cropUnitValue + reforgeBonus);
      const uptimeMultiplier = Math.max(0, 1 - ((pestsPerHour * KILL_SECONDS_PER_PEST) / 3600));
      const cropProfitPerHour = grossCropProfitPerHour * uptimeMultiplier;

      const weights = getPestWeights(bait, vinyl.key);
      const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
      const pestBreakdown = await Promise.all(weights.map(async (entry) => {
        const effectiveFortune = bait.pestKeys.includes(entry.pest.key) ? fortune : nonBaitFortune;
        const valuePerKill = await calculatePestValuePerKill(effectiveFortune, entry.pest, sellMethod, stats.pestShardLevel);
        const share = entry.weight / totalWeight;
        const pestRate = pestsPerHour * share;
        return {
          pest: entry.pest,
          share: share * 100,
          pestsPerHour: pestRate,
          valuePerKill,
          profitPerHour: pestRate * valuePerKill
        };
      }));

      pestBreakdown.sort((left, right) => right.profitPerHour - left.profitPerHour || left.pest.label.localeCompare(right.pest.label));

      const pestProfitPerHour = pestBreakdown.reduce((sum, entry) => sum + entry.profitPerHour, 0);
      const netProfitPerHour = cropProfitPerHour + pestProfitPerHour - baitCostPerHour;

      await interaction.editReply({
        embeds: [buildProfitEmbed({
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
          pestProfitPerHour,
          netProfitPerHour,
          topPests: pestBreakdown.slice(0, 5),
          nonBaitFortune
        })]
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to calculate pest farming profit.'
      });
    }
  }

  return {
    handleSetFarmingStatsCommand,
    handlePestFarmingProfitsCommand,
    BAITS,
    CROPS
  };
}

module.exports = { createPestFarmingProfitFeature, BAITS, CROPS, REFORGE_OPTIONS };
