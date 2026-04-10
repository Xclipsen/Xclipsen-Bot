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

  function simplifySearchValue(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');
  }

  function splitSearchTokens(value) {
    return String(value || '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function levenshteinDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');

    if (!a) {
      return b.length;
    }

    if (!b) {
      return a.length;
    }

    const previous = new Array(b.length + 1).fill(0);
    const current = new Array(b.length + 1).fill(0);

    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = column;
    }

    for (let row = 1; row <= a.length; row += 1) {
      current[0] = row;

      for (let column = 1; column <= b.length; column += 1) {
        const cost = a[row - 1] === b[column - 1] ? 0 : 1;
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + cost
        );
      }

      for (let column = 0; column <= b.length; column += 1) {
        previous[column] = current[column];
      }
    }

    return previous[b.length];
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
          cachedData = {
            itemHash,
            emojis,
            customIds: Object.keys(itemHash).sort()
          };
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
    const fileExtension = preferredVariant.animated ? 'gif' : 'png';

    return {
      customId: normalizedCustomId,
      hash,
      variant: options.enchanted && variants.enchanted ? 'enchanted' : 'normal',
      formatted: `<${prefix}:${preferredVariant.name}:${preferredVariant.id}>`,
      cdnUrl: `https://cdn.discordapp.com/emojis/${preferredVariant.id}.${fileExtension}?size=128&quality=lossless`,
      fileExtension,
      raw: preferredVariant
    };
  }

  async function suggestCustomIds(input, options = {}) {
    if (env.SKYBLOCK_ITEM_EMOJIS_ENABLED === false) {
      return [];
    }

    const limit = Math.max(1, Math.min(25, Number(options.limit) || 25));
    const normalizedInput = normalizeCustomId(input);
    const simplifiedInput = simplifySearchValue(input);
    const inputTokens = splitSearchTokens(input);
    const { customIds } = await ensureLoaded();

    if (!normalizedInput) {
      return customIds.slice(0, limit);
    }

    const ranked = customIds
      .map((customId) => {
        const simplifiedCustomId = simplifySearchValue(customId);
        const customIdTokens = splitSearchTokens(customId);
        let score = 0;

        if (customId === normalizedInput) {
          score += 100000;
        } else if (customId.startsWith(normalizedInput)) {
          score += 20000 - Math.max(0, customId.length - normalizedInput.length);
        } else if (customId.includes(normalizedInput)) {
          score += 15000 - customId.indexOf(normalizedInput);
        }

        if (simplifiedInput) {
          if (simplifiedCustomId === simplifiedInput) {
            score += 18000;
          } else if (simplifiedCustomId.startsWith(simplifiedInput)) {
            score += 12000 - Math.max(0, simplifiedCustomId.length - simplifiedInput.length);
          } else if (simplifiedCustomId.includes(simplifiedInput)) {
            score += 9000 - simplifiedCustomId.indexOf(simplifiedInput);
          }

          const distance = levenshteinDistance(simplifiedInput, simplifiedCustomId);
          const maxDistance = Math.max(2, Math.ceil(simplifiedInput.length / 3));
          if (distance <= maxDistance) {
            score += 6000 - (distance * 400);
          }
        }

        if (inputTokens.length > 0) {
          for (const token of inputTokens) {
            if (customIdTokens.includes(token)) {
              score += 1200;
              continue;
            }

            if (customIdTokens.some((entry) => entry.startsWith(token))) {
              score += 700;
              continue;
            }

            if (customId.includes(token)) {
              score += 300;
            }
          }
        }

        return { customId, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.customId.localeCompare(right.customId));

    return ranked.slice(0, limit).map((entry) => entry.customId);
  }

  return {
    normalizeCustomId,
    resolveEmoji,
    suggestCustomIds
  };
}

module.exports = { createSkyblockItemEmojiUtils };
