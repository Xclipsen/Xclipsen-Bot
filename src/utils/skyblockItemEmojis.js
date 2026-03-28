const DEFAULT_ITEM_HASH_URL = 'https://raw.githubusercontent.com/Altpapier/Skyblock-Item-Emojis/main/v3/itemHash.json';
const DEFAULT_EMOJI_DATA_URL = 'https://raw.githubusercontent.com/Altpapier/Skyblock-Item-Emojis/main/v3/emojis.json';

function createSkyblockItemEmojiUtils(env = {}) {
  let cachedData = null;
  let loadPromise = null;

  function normalizeCustomId(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '_')
      .toUpperCase();
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'hypixel-mayor-discord-bot/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Skyblock item emoji data (${response.status}) from ${url}`);
    }

    return response.json();
  }

  async function ensureLoaded() {
    if (cachedData) {
      return cachedData;
    }

    if (!loadPromise) {
      loadPromise = Promise.all([
        fetchJson(env.SKYBLOCK_ITEM_EMOJI_HASH_URL || DEFAULT_ITEM_HASH_URL),
        fetchJson(env.SKYBLOCK_ITEM_EMOJI_DATA_URL || DEFAULT_EMOJI_DATA_URL)
      ])
        .then(([itemHash, emojis]) => {
          cachedData = { itemHash, emojis };
          return cachedData;
        })
        .finally(() => {
          loadPromise = null;
        });
    }

    return loadPromise;
  }

  async function resolveEmoji(customId, options = {}) {
    if (env.SKYBLOCK_ITEM_EMOJIS_ENABLED === false) {
      return null;
    }

    const normalizedCustomId = normalizeCustomId(customId);
    if (!normalizedCustomId) {
      return null;
    }

    const { itemHash, emojis } = await ensureLoaded();
    const hash = itemHash[normalizedCustomId];
    if (!hash) {
      return null;
    }

    const variants = emojis[hash];
    if (!variants) {
      return null;
    }

    const preferredVariant = options.enchanted ? variants.enchanted || variants.normal : variants.normal || variants.enchanted;
    if (!preferredVariant?.id || !preferredVariant?.name) {
      return null;
    }

    const prefix = preferredVariant.animated ? 'a' : '';

    return {
      customId: normalizedCustomId,
      hash,
      variant: options.enchanted && variants.enchanted ? 'enchanted' : 'normal',
      formatted: `<${prefix}:${preferredVariant.name}:${preferredVariant.id}>`,
      raw: preferredVariant
    };
  }

  return {
    normalizeCustomId,
    resolveEmoji
  };
}

module.exports = { createSkyblockItemEmojiUtils };
