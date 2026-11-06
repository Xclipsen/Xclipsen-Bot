const fs = require('node:fs');
const path = require('node:path');

// Application emojis belong to the bot, so they render in every guild and in interaction replies.
// assets/app-emojis/manifest.json lists the icons; missing ones are uploaded on ready. Until then,
// or when Discord rejects them, every lookup returns the caller's Unicode fallback.
const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', '..', 'assets', 'app-emojis', 'manifest.json');
const EMOJI_NAME_PATTERN = /^[a-z0-9_]{2,32}$/;
const MAX_EMOJI_BYTES = 256 * 1024;
const CDN_BASE_URL = 'https://cdn.discordapp.com/emojis';

function loadAppEmojiManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const directory = path.dirname(manifestPath);

  return Object.entries(manifest).map(([name, entry]) => {
    if (!EMOJI_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid application emoji name in ${manifestPath}: ${name}`);
    }

    const file = String(entry?.file || '');
    if (!file || path.basename(file) !== file) {
      throw new Error(`Application emoji ${name} needs a file name inside ${directory}.`);
    }

    return { name, filePath: path.join(directory, file) };
  });
}

function formatEmojiToken({ name, id, animated }) {
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

function createAppEmojis({ manifestPath = DEFAULT_MANIFEST_PATH, entries = null, readFile = fs.promises.readFile, logger = console } = {}) {
  const loaded = new Map();
  let manifestEntries = entries;
  let syncPromise = null;

  function getManifestEntries() {
    if (!manifestEntries) {
      try {
        manifestEntries = loadAppEmojiManifest(manifestPath);
      } catch (error) {
        logger.error('Could not read the application emoji manifest; using Unicode fallbacks:', error);
        manifestEntries = [];
      }
    }

    return manifestEntries;
  }

  function remember(emoji) {
    if (emoji?.id && emoji?.name) {
      loaded.set(emoji.name, { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) });
    }
  }

  async function readEmojiFile(filePath) {
    const buffer = await readFile(filePath);
    if (buffer.length > MAX_EMOJI_BYTES) {
      throw new Error(`${path.basename(filePath)} is larger than 256 KB.`);
    }
    return buffer;
  }

  // Uploads only names the application does not have yet; existing and foreign emojis stay untouched.
  async function runSync(client) {
    const manager = client?.application?.emojis;
    if (!manager || typeof manager.fetch !== 'function') {
      logger.warn('Application emojis are not available; using Unicode fallbacks.');
      return;
    }

    let existing;
    try {
      existing = await manager.fetch();
    } catch (error) {
      logger.error('Could not load application emojis; using Unicode fallbacks:', error);
      return;
    }

    for (const emoji of existing.values()) {
      remember(emoji);
    }

    const missing = getManifestEntries().filter((entry) => !loaded.has(entry.name));
    const failed = [];
    let firstError = null;

    for (const entry of missing) {
      try {
        const created = await manager.create({ attachment: await readEmojiFile(entry.filePath), name: entry.name });
        remember(created);
      } catch (error) {
        failed.push(entry.name);
        firstError ||= error;
      }
    }

    if (failed.length > 0) {
      logger.error(`Could not upload ${failed.length} application emojis (${failed.join(', ')}); using Unicode fallbacks for them:`, firstError);
    }

    const uploaded = missing.length - failed.length;
    logger.log(`Application emojis ready: ${getManifestEntries().length - failed.length}/${getManifestEntries().length}${uploaded > 0 ? ` (${uploaded} uploaded)` : ''}`);
  }

  // Safe to call again (e.g. after a reconnect); concurrent calls share one run.
  function sync(client) {
    if (!syncPromise) {
      syncPromise = runSync(client)
        .catch((error) => logger.error('Application emoji sync failed; using Unicode fallbacks:', error))
        .finally(() => {
          syncPromise = null;
        });
    }

    return syncPromise;
  }

  function get(name, fallback = '') {
    const emoji = loaded.get(name);
    return emoji ? formatEmojiToken(emoji) : fallback;
  }

  function url(name) {
    const emoji = loaded.get(name);
    return emoji ? `${CDN_BASE_URL}/${emoji.id}.${emoji.animated ? 'gif' : 'png'}` : null;
  }

  return {
    get,
    url,
    has: (name) => loaded.has(name),
    sync
  };
}

// For features created without the service (tests, tools): always the Unicode fallback.
const NO_APP_EMOJIS = Object.freeze({
  get: (name, fallback = '') => fallback,
  url: () => null,
  has: () => false,
  sync: async () => {}
});

module.exports = { createAppEmojis, loadAppEmojiManifest, NO_APP_EMOJIS, DEFAULT_MANIFEST_PATH };
