const { EmbedBuilder } = require('discord.js');

const INSTA_SELL = 'insta_sell';
const SELL_ORDER = 'sell_order';
const NPC_SELL = 'npc_sell';
const REFERENCE_FORTUNE = 2500;
const BASE_GUARANTEED_COINS = 1000;
const PEST_ERADICATOR_NAME = 'Pest Eradicator';
const PEST_ERADICATOR_DESCRIPTION = 'The duration of Pesthunter Phillip\'s Farming Fortune bonus is now 60m. Decreases the spawn cooldown of Pests by 20%.';
const BAZAAR_CACHE_TTL_MS = 60 * 1000;
const ELECTION_CACHE_TTL_MS = 60 * 1000;

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
        { type: 'direct', productId: 'ENCHANTED_RED_MUSHROOM', amount: 1 },
        { type: 'direct', productId: 'ENCHANTED_BROWN_MUSHROOM', amount: 1 }
      ]
    },
    targetNpcAt2500: 187190
  },
  {
    key: 'beetle',
    label: 'Beetle',
    guaranteed: {
      baseAmount: 3,
      scaling: 12,
      unitNpcValue: 480,
      marketBundle: [
        { type: 'direct', productId: 'ENCHANTED_NETHER_STALK', amount: 1 }
      ]
    },
    targetNpcAt2500: 173850
  },
  {
    key: 'earthworm',
    label: 'Earthworm',
    guaranteed: {
      baseAmount: 5,
      scaling: 7,
      unitNpcValue: 320,
      marketBundle: [
        { type: 'derived', productId: 'ENCHANTED_MELON', amount: 1 / 160 }
      ]
    },
    targetNpcAt2500: 151710
  },
  {
    key: 'cricket',
    label: 'Cricket',
    guaranteed: {
      baseAmount: 3,
      scaling: 10.5,
      unitNpcValue: 480,
      marketBundle: [
        { type: 'direct', productId: 'ENCHANTED_CARROT', amount: 1 }
      ]
    },
    targetNpcAt2500: 150520
  },
  {
    key: 'locust',
    label: 'Locust',
    guaranteed: {
      baseAmount: 3,
      scaling: 10.5,
      unitNpcValue: 480,
      marketBundle: [
        { type: 'direct', productId: 'ENCHANTED_POTATO', amount: 1 }
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
        { type: 'direct', productId: 'ENCHANTED_PUMPKIN', amount: 1 }
      ]
    },
    targetNpcAt2500: 148440
  },
  {
    key: 'moth',
    label: 'Moth',
    guaranteed: {
      baseAmount: 3,
      scaling: 12,
      unitNpcValue: 480,
      marketBundle: [
        { type: 'direct', productId: 'ENCHANTED_COCOA', amount: 1 }
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
        { type: 'direct', productId: 'ENCHANTED_SUGAR', amount: 2 }
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
        { type: 'direct', productId: 'ENCHANTED_CACTUS_GREEN', amount: 1 }
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
        { type: 'direct', productId: 'ENCHANTED_WHEAT', amount: 1 }
      ]
    },
    targetNpcAt2500: 97000
  }
];

let cachedBazaarProducts = null;
let cachedBazaarFetchedAt = 0;
let cachedElectionState = null;
let cachedElectionFetchedAt = 0;

function createBestPestFeature({ env }) {
  function normalizeText(value) {
    return String(value || '')
      .replace(/§./g, '')
      .replace(/☘/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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

  function calculateNpcValuePerKill(fortune, pest) {
    const guaranteedValue = calculateGuaranteedNpcValue(fortune, pest);
    const guaranteedAtReference = calculateGuaranteedNpcValue(REFERENCE_FORTUNE, pest);
    const referenceRareValue = Math.max(0, pest.targetNpcAt2500 - guaranteedAtReference);
    const scaledRareValue = referenceRareValue * calculateRareScaling(fortune);
    return guaranteedValue + scaledRareValue;
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

  function getBazaarUnitPrice(products, method, component) {
    if (component.type === 'direct') {
      const product = products[component.productId];
      if (!product?.quick_status) {
        return null;
      }

      return method === INSTA_SELL
        ? Number(product.quick_status.sellPrice) || 0
        : Number(product.quick_status.buyPrice) || 0;
    }

    if (component.type === 'derived') {
      const product = products[component.productId];
      if (!product?.quick_status) {
        return null;
      }

      const basePrice = method === INSTA_SELL
        ? Number(product.quick_status.sellPrice) || 0
        : Number(product.quick_status.buyPrice) || 0;
      return basePrice * component.amount;
    }

    return null;
  }

  function calculateGuaranteedMarketValue(fortune, pest, products, method) {
    const amount = calculateGuaranteedAmount(fortune, pest.guaranteed);
    const bundle = Array.isArray(pest.guaranteed.marketBundle) ? pest.guaranteed.marketBundle : [];

    if (bundle.length === 0) {
      return calculateGuaranteedNpcValue(fortune, pest);
    }

    const bundleUnitValue = bundle.reduce((sum, component) => {
      const componentUnitPrice = getBazaarUnitPrice(products, method, component);
      if (componentUnitPrice == null) {
        return sum;
      }

      const componentAmount = component.type === 'direct' ? component.amount : 1;
      return sum + (componentUnitPrice * componentAmount);
    }, 0);

    if (bundleUnitValue <= 0) {
      return calculateGuaranteedNpcValue(fortune, pest);
    }

    return (amount * bundleUnitValue) + BASE_GUARANTEED_COINS;
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

  async function calculateValuePerKill(fortune, pest, sellMethod) {
    if (sellMethod === NPC_SELL) {
      return calculateNpcValuePerKill(fortune, pest);
    }

    const products = await fetchBazaarProducts();
    const npcValue = calculateNpcValuePerKill(fortune, pest);
    const npcGuaranteedValue = calculateGuaranteedNpcValue(fortune, pest);
    const marketGuaranteedValue = calculateGuaranteedMarketValue(fortune, pest, products, sellMethod);
    return npcValue - npcGuaranteedValue + marketGuaranteedValue;
  }

  function formatFortune(value) {
    return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
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

  function getMayorStatusLine(enabled) {
    return enabled
      ? `Mayor Finnegan: Enabled (${PEST_ERADICATOR_NAME})`
      : `Mayor Finnegan: Disabled (${PEST_ERADICATOR_NAME})`;
  }

  async function handleBestPestCommand(interaction) {
    const fortune = interaction.options.getInteger('fortune', true);
    const sellMethod = interaction.options.getString('sell_method', true);

    await interaction.deferReply();

    try {
      if (![INSTA_SELL, SELL_ORDER, NPC_SELL].includes(sellMethod)) {
        throw new Error('Unsupported `sell_method`.');
      }

      const [finneganEnabled, rankedPests] = await Promise.all([
        isPestEradicatorActive(),
        Promise.all(PESTS.map(async (pest, index) => ({
          ...pest,
          originalIndex: index,
          valuePerKill: await calculateValuePerKill(fortune, pest, sellMethod)
        })))
      ]);

      rankedPests.sort((left, right) => right.valuePerKill - left.valuePerKill || left.originalIndex - right.originalIndex);

      const footerText = sellMethod === NPC_SELL
        ? 'NPC Sell is calibrated to the current pest drop formulas.'
        : 'Bazaar methods use live Hypixel Bazaar prices for guaranteed drops. Unsupported rare/AH-only drops stay on the calibrated estimate.';

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Best Pest to Farm')
        .setDescription([
          `Farming Fortune: ${formatFortune(fortune)}`,
          `Sell Method: ${SELL_METHOD_LABELS[sellMethod] || sellMethod}`,
          getMayorStatusLine(finneganEnabled),
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
  PESTS,
  INSTA_SELL,
  SELL_ORDER,
  NPC_SELL,
  SELL_METHOD_LABELS,
  PEST_ERADICATOR_NAME,
  PEST_ERADICATOR_DESCRIPTION
};
