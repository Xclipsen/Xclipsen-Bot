const { EmbedBuilder } = require('discord.js');

const { normalizeText } = require('../utils/skyblock');

const INSTA_SELL = 'insta_sell';
const SELL_ORDER = 'sell_order';
const NPC_SELL = 'npc_sell';
const REFERENCE_FORTUNE = 2500;
const BASE_GUARANTEED_COINS = 1000;
const PEST_ERADICATOR_NAME = 'Pest Eradicator';
const PEST_SHARD_RARE_BONUS_PER_LEVEL = 0.02;

const SELL_METHOD_LABELS = {
  [INSTA_SELL]: 'Instasell',
  [SELL_ORDER]: 'Sell Order',
  [NPC_SELL]: 'NPC Sell'
};

const PESTS = [
  {
    key: 'slug',
    label: 'Slug',
    guaranteed: {
      baseAmount: 1,
      scaling: 35,
      unitNpcValue: 1596,
      marketBundle: [
        { productId: 'ENCHANTED_RED_MUSHROOM', amount: 1, poolId: 'enchanted_mushroom' },
        { productId: 'ENCHANTED_BROWN_MUSHROOM', amount: 1, poolId: 'enchanted_mushroom' }
      ]
    },
    targetNpcAt2500: 187190
  },
  {
    key: 'beetle',
    label: 'Beetle',
    guaranteed: {
      baseAmount: 1,
      scaling: 12,
      unitNpcValue: 480,
      marketBundle: [
        { productId: 'ENCHANTED_NETHER_STALK', amount: 1 }
      ]
    },
    targetNpcAt2500: 173850
  },
  {
    key: 'earthworm',
    label: 'Earthworm',
    guaranteed: {
      baseAmount: 1,
      scaling: 7,
      unitNpcValue: 320,
      marketBundle: [
        { productId: 'ENCHANTED_MELON', amount: 1 / 160 }
      ]
    },
    targetNpcAt2500: 151710
  },
  {
    key: 'cricket',
    label: 'Cricket',
    guaranteed: {
      baseAmount: 1,
      scaling: 10.5,
      unitNpcValue: 480,
      marketBundle: [
        { productId: 'ENCHANTED_CARROT', amount: 1 }
      ]
    },
    targetNpcAt2500: 150520
  },
  {
    key: 'locust',
    label: 'Locust',
    guaranteed: {
      baseAmount: 1,
      scaling: 10.5,
      unitNpcValue: 480,
      marketBundle: [
        { productId: 'ENCHANTED_POTATO', amount: 1 }
      ]
    },
    targetNpcAt2500: 150520
  },
  {
    key: 'rat',
    label: 'Rat',
    guaranteed: {
      baseAmount: 1,
      scaling: 35,
      unitNpcValue: 1600,
      marketBundle: [
        { productId: 'ENCHANTED_PUMPKIN', amount: 1 }
      ]
    },
    targetNpcAt2500: 148440
  },
  {
    key: 'moth',
    label: 'Moth',
    guaranteed: {
      baseAmount: 1,
      scaling: 12,
      unitNpcValue: 480,
      marketBundle: [
        { productId: 'ENCHANTED_COCOA', amount: 1 }
      ]
    },
    targetNpcAt2500: 140590
  },
  {
    key: 'dragonfly',
    label: 'Dragonfly',
    guaranteed: {
      baseAmount: 2,
      scaling: 17.5,
      unitNpcValue: 640
    },
    targetNpcAt2500: 128200
  },
  {
    key: 'firefly',
    label: 'Firefly',
    guaranteed: {
      baseAmount: 2,
      scaling: 17.5,
      unitNpcValue: 640
    },
    targetNpcAt2500: 128200
  },
  {
    key: 'praying_mantis',
    label: 'Praying Mantis',
    guaranteed: {
      baseAmount: 2,
      scaling: 17.5,
      unitNpcValue: 440
    },
    targetNpcAt2500: 126910
  },
  {
    key: 'mosquito',
    label: 'Mosquito',
    guaranteed: {
      baseAmount: 2,
      scaling: 17.5,
      unitNpcValue: 640,
      marketBundle: [
        { productId: 'ENCHANTED_SUGAR', amount: 2 }
      ]
    },
    targetNpcAt2500: 124320
  },
  {
    key: 'mite',
    label: 'Mite',
    guaranteed: {
      baseAmount: 2,
      scaling: 17.5,
      unitNpcValue: 640,
      marketBundle: [
        { productId: 'ENCHANTED_CACTUS_GREEN', amount: 1 }
      ]
    },
    targetNpcAt2500: 124320
  },
  {
    key: 'fly',
    label: 'Fly',
    guaranteed: {
      baseAmount: 1,
      scaling: 35,
      unitNpcValue: 960,
      marketBundle: [
        { productId: 'ENCHANTED_WHEAT', amount: 1 }
      ]
    },
    targetNpcAt2500: 97000
  }
];

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

// Instasell sells into buy orders (sellPrice); a sell order waits for the higher buyPrice.
function getBazaarUnitPrice(products, productId, method) {
  const product = products?.[productId];
  if (!product?.quick_status) {
    return null;
  }

  return method === SELL_ORDER
    ? Number(product.quick_status.buyPrice) || 0
    : Number(product.quick_status.sellPrice) || 0;
}

function calculateGuaranteedMarketValue(fortune, pest, products, method) {
  const amount = calculateGuaranteedAmount(fortune, pest.guaranteed);
  const bundle = Array.isArray(pest.guaranteed.marketBundle) ? pest.guaranteed.marketBundle : [];

  if (bundle.length === 0) {
    return calculateGuaranteedNpcValue(fortune, pest);
  }

  const pooledBundleValues = new Map();
  const directBundleValue = bundle.reduce((sum, component) => {
    const price = getBazaarUnitPrice(products, component.productId, method);
    if (price == null) {
      return sum;
    }

    // `amount` is the item count per guaranteed drop (a fraction for drops priced via their enchanted form).
    const componentValue = price * component.amount;
    if (component.poolId) {
      pooledBundleValues.set(component.poolId, [...(pooledBundleValues.get(component.poolId) || []), componentValue]);
      return sum;
    }

    return sum + componentValue;
  }, 0);

  // Shared drop pools represent one drop choice, not multiple guaranteed drops.
  const pooledBundleValue = [...pooledBundleValues.values()]
    .reduce((sum, values) => sum + (values.reduce((poolSum, value) => poolSum + value, 0) / values.length), 0);

  const bundleUnitValue = directBundleValue + pooledBundleValue;

  if (bundleUnitValue <= 0) {
    return calculateGuaranteedNpcValue(fortune, pest);
  }

  return (amount * bundleUnitValue) + BASE_GUARANTEED_COINS;
}

function getRareDropMultiplier(pestShardLevel) {
  return 1 + (Math.max(0, Number(pestShardLevel) || 0) * PEST_SHARD_RARE_BONUS_PER_LEVEL);
}

function formatRareDropBonus(pestShardLevel) {
  return `+${Math.round(Math.max(0, Number(pestShardLevel) || 0) * PEST_SHARD_RARE_BONUS_PER_LEVEL * 100)}% rare drops`;
}

// Coins per kill; `products` (Bazaar data) is only read for the Bazaar sell methods.
function calculateValuePerKill(fortune, pest, sellMethod, pestShardLevel, products) {
  const npcValue = calculateNpcValuePerKill(fortune, pest, getRareDropMultiplier(pestShardLevel));
  if (sellMethod === NPC_SELL) {
    return npcValue;
  }

  return npcValue - calculateGuaranteedNpcValue(fortune, pest) + calculateGuaranteedMarketValue(fortune, pest, products, sellMethod);
}

function normalizePerkName(value) {
  return normalizeText(value).replace(/☘/g, '').replace(/\s+/g, ' ').trim();
}

function isPestEradicatorActive(electionState) {
  const mayor = electionState?.mayor || null;
  const perkKey = normalizePerkName(PEST_ERADICATOR_NAME);
  const isFinnegan = normalizeText(mayor?.key) === 'finnegan' || normalizeText(mayor?.name) === 'finnegan';
  const mayorPerks = Array.isArray(mayor?.perks) ? mayor.perks.map((perk) => normalizePerkName(perk?.name)) : [];

  return (isFinnegan && mayorPerks.includes(perkKey)) || normalizePerkName(mayor?.minister?.perk?.name) === perkKey;
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

function createBestPestFeature({ store, hypixelApi }) {
  function getPestShardLevel(discordUserId) {
    return Math.max(0, Number(store.getUserFarmingStats(discordUserId)?.pestShardLevel) || 0);
  }

  function formatFortune(value) {
    return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
  }

  async function handleBestPestCommand(interaction) {
    const fortune = interaction.options.getInteger('fortune', true);
    const sellMethod = interaction.options.getString('sell_method', true);
    const pestShardLevel = getPestShardLevel(interaction.user.id);

    await interaction.deferReply();

    try {
      if (!Object.hasOwn(SELL_METHOD_LABELS, sellMethod)) {
        throw new Error('Unsupported `sell_method`.');
      }

      const [electionState, products] = await Promise.all([
        hypixelApi.getElection(),
        sellMethod === NPC_SELL ? null : hypixelApi.getBazaar()
      ]);
      const rankedPests = PESTS
        .map((pest, index) => ({
          ...pest,
          originalIndex: index,
          valuePerKill: calculateValuePerKill(fortune, pest, sellMethod, pestShardLevel, products)
        }))
        .sort((left, right) => right.valuePerKill - left.valuePerKill || left.originalIndex - right.originalIndex);

      const footerText = sellMethod === NPC_SELL
        ? 'NPC Sell is calibrated to the current pest drop formulas.'
        : 'Bazaar methods use live Hypixel Bazaar prices for guaranteed drops. Unsupported rare/AH-only drops stay on the calibrated estimate.';

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Best Pest to Farm')
        .setDescription([
          `Farming Fortune: ${formatFortune(fortune)}`,
          `Sell Method: ${SELL_METHOD_LABELS[sellMethod]}`,
          `Mayor Finnegan: ${isPestEradicatorActive(electionState) ? 'Enabled' : 'Disabled'} (${PEST_ERADICATOR_NAME})`,
          `Pest Shard Level: ${pestShardLevel} (${formatRareDropBonus(pestShardLevel)})`,
          '',
          ...rankedPests.map((pest, index) => `${index + 1}. **${pest.label}** - ${formatCoins(pest.valuePerKill)} per kill`)
        ].join('\n'))
        .setFooter({
          text: footerText
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to calculate the best pest.'
      });
    }
  }

  return {
    handleBestPestCommand
  };
}

module.exports = {
  createBestPestFeature,
  calculateValuePerKill,
  isPestEradicatorActive,
  getBazaarUnitPrice,
  formatCoins,
  formatRareDropBonus,
  PESTS,
  INSTA_SELL,
  SELL_ORDER,
  NPC_SELL,
  SELL_METHOD_LABELS
};
