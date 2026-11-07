// The last interrupted music session per server (data/music-resume.json), for /music continue:
// { guilds: { <guildId>: { current, position, queue, loop, savedAt, savedBy, reason } } }
// `current` and `queue` hold queue items ({ kind, title, url, duration, isLive, requesterId, … });
// autoplay suggestions keep addedBy: 'autoplay' so they are never taken for a member's pick;
// `position` is where the current track was, in seconds. Snapshots expire after 24 hours.
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESUME_QUEUE = 100;
const { isYouTubeVideoUrl } = require('./sources');
const { parseSpotifyLink } = require('./spotify');
const { findStation } = require('./stations');

const ITEM_KEYS = ['kind', 'title', 'url', 'source', 'author', 'album', 'duration', 'isLive', 'thumbnail', 'stationKey', 'requesterId', 'spotifyUrl', 'artists', 'addedBy'];

// The file could have been edited by hand: tracks must be single YouTube videos, Spotify items
// Spotify track links (their YouTube URL may still be missing), radio items a station that exists.
// Radio URLs are never used from here; /music continue looks the station up (and checks custom
// station URLs) again.
function validItem(item) {
  if (!item || typeof item.title !== 'string') return null;
  if (item.kind === 'spotify') {
    if (parseSpotifyLink(item.spotifyUrl)?.type !== 'track') return null;
    return { url: isYouTubeVideoUrl(item.url) ? item.url : null };
  }
  if (item.kind === 'radio') {
    const key = String(item.stationKey || '');
    return key.startsWith('custom:') || findStation(key) ? { url: null } : null;
  }
  return isYouTubeVideoUrl(item.url) ? { url: item.url } : null;
}

function normalizeItem(item) {
  const valid = validItem(item);
  if (!valid) return null;
  const clean = Object.fromEntries(ITEM_KEYS.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]));
  clean.kind = ['radio', 'spotify'].includes(item.kind) ? item.kind : 'track';
  clean.url = valid.url;
  // Only autoplay suggestions are marked; everything else was picked by a member.
  if (clean.addedBy !== 'autoplay') delete clean.addedBy;
  if (clean.artists !== undefined) clean.artists = (Array.isArray(clean.artists) ? clean.artists : []).map(String).slice(0, 10);
  return clean;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const current = normalizeItem(snapshot.current);
  const queue = (Array.isArray(snapshot.queue) ? snapshot.queue : []).map(normalizeItem).filter(Boolean).slice(0, MAX_RESUME_QUEUE);
  if (!current && !queue.length) return null;
  return {
    current,
    position: Number.isFinite(snapshot.position) ? Math.max(0, Math.floor(snapshot.position)) : 0,
    queue,
    loop: ['track', 'queue'].includes(snapshot.loop) ? snapshot.loop : 'off',
    savedAt: Number.isFinite(snapshot.savedAt) ? snapshot.savedAt : 0,
    savedBy: snapshot.savedBy ? String(snapshot.savedBy) : null,
    reason: snapshot.reason ? String(snapshot.reason) : null
  };
}

function createResumeStore({ filePath = null, load, save, now = Date.now, ttlMs = RESUME_TTL_MS } = {}) {
  const jsonFiles = filePath && (!load || !save) ? require('../../storage/store') : null;
  const loadFile = load || jsonFiles?.loadJsonFile;
  const saveFile = save || jsonFiles?.saveJsonFile;
  const raw = filePath ? loadFile(filePath, { guilds: {} }) : { guilds: {} };
  let guilds = Object.fromEntries(Object.entries(raw?.guilds && typeof raw.guilds === 'object' ? raw.guilds : {})
    .map(([guildId, snapshot]) => [guildId, normalizeSnapshot(snapshot)])
    .filter(([, snapshot]) => snapshot));

  function persist() {
    if (filePath) saveFile(filePath, { guilds });
  }

  function get(guildId) {
    const snapshot = guilds[guildId] || null;
    if (snapshot && now() - snapshot.savedAt > ttlMs) {
      clear(guildId);
      return null;
    }
    return snapshot;
  }

  // Returns the stored snapshot, or null when there was nothing to keep.
  function set(guildId, snapshot) {
    const clean = normalizeSnapshot({ ...snapshot, savedAt: now() });
    if (!clean) return null;
    guilds = { ...guilds, [guildId]: clean };
    persist();
    return clean;
  }

  function clear(guildId) {
    if (!guilds[guildId]) return;
    const { [guildId]: _removed, ...rest } = guilds;
    guilds = rest;
    persist();
  }

  return { get, set, clear };
}

module.exports = { RESUME_TTL_MS, MAX_RESUME_QUEUE, createResumeStore };
