const { cleanTitle, normalize, VERSION_MARKERS } = require('./spotify');

// Autoplay picks songs related to what was played from the "radio" playlist YouTube builds for a
// video. YouTube Music's radio (list=RDAMVM<id>) keeps closer to music-only uploads (fewer lyric
// re-uploads, EPs and "mix" videos); the plain YouTube Mix (list=RD<id>) is the fallback. Both are
// read with one flat yt-dlp lookup of the first MIX_SIZE entries (see sources.fetchMix).
const MIX_SIZE = 25;
const HISTORY_SIZE = 50;
const SEED_COUNT = 3;
const MIN_SECONDS = 60;
const MAX_SECONDS = 10 * 60;
// At most this many tracks in a row by the same artist or channel.
const MAX_SAME_ARTIST = 2;

// Uploads that are no single song (or a different version of one); skipped unless the seed has the
// same marker. The Spotify penalty words (cover, nightcore, sped up, reaction, 8d, …) count too.
const NO_SONG_MARKERS = [
  /\blive\b/, /\bstream(?:ing)?\b/, /\b\d+\s*(?:hours?|hrs?)\b/, /\bmix\b/, /\bplaylist\b/, /\bcompilation\b/,
  /\bfull (?:album|ep)\b/, /\bep\b/, /\bbest of\b/, /\bgreatest hits\b/, /\btop \d+\b/, /\bnon ?stop\b/, /\bmegamix\b/, /\bmashup\b/
];
const MARKERS = [...NO_SONG_MARKERS, ...VERSION_MARKERS.map(([, pattern]) => pattern)];
const DASH = /\s+[-–—]\s+/;
const CHANNEL_NOISE = /\s+-\s+topic$|vevo$|\bofficial\b|\bmusic\b$/gi;

function videoIdOf(url) {
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
    else if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
    else id = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] || null;
    return id && /^[\w-]{1,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function channelName(channel) {
  return normalize(String(channel || '').replace(CHANNEL_NOISE, ''));
}

function firstArtist(text) {
  return String(text || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b|\bwith\b)\s*/i).find(Boolean) || '';
}

// Title without brackets, feat./prod. credits and "Official Video"-like noise.
function songPart(text) {
  const { title } = cleanTitle(String(text || '').replace(/\s*[([{][^)\]}]*[)\]}]/g, ' '));
  return normalize(title
    .replace(/\s+\b(?:prod|produced)\.?\s+(?:by\s+)?.*$/i, '')
    .replace(/\s+\b(?:feat|ft|featuring)\.?\s+.*$/i, '')
    .replace(/\b(?:official|music|lyrics?|video|audio|visualizer|hd|4k)\b/gi, ' '));
}

// { videoId, key, artist, channel, title } of a queue item or mix entry. `key` is the normalized
// "artist - title" so re-uploads of a song count as the same song.
function trackIdentity(item) {
  const title = String(item?.title || '');
  const channel = channelName(item?.author ?? item?.uploader);
  let artist;
  let song;
  if (Array.isArray(item?.artists) && item.artists.length) {
    artist = normalize(item.artists[0]);
    song = songPart(title);
  } else {
    const parts = title.split(DASH);
    if (parts.length >= 2) {
      let [left, ...rest] = parts;
      let right = rest.join(' ');
      // "In The End [Official Video] - Linkin Park"
      if (channel && normalize(firstArtist(right)) === channel && normalize(firstArtist(left)) !== channel) [left, right] = [right, left];
      artist = normalize(firstArtist(left));
      song = songPart(right);
    } else {
      artist = channel;
      song = songPart(title);
    }
  }
  return {
    videoId: videoIdOf(item?.url) || (typeof item?.id === 'string' ? item.id : null),
    key: `${artist} - ${song || normalize(title)}`,
    artist,
    channel,
    title
  };
}

function hasMarker(text) {
  const value = normalize(text);
  return MARKERS.filter((pattern) => pattern.test(value));
}

function sameArtist(a, b) {
  return Boolean((a.artist && (a.artist === b.artist || a.artist === b.channel))
    || (a.channel && (a.channel === b.channel || a.channel === b.artist)));
}

// Topic channels carry the studio recording, official/verified channels come next; earlier entries
// of the mix are closer to the seed.
function score(entry, identity, index) {
  const uploader = String(entry.uploader || '');
  let value = MIX_SIZE - index;
  if (/\s-\s+topic$/i.test(uploader)) value += 15;
  else if (entry.verified || /vevo$/i.test(uploader.replace(/\s/g, '')) || /\bofficial\b/i.test(uploader)
    || (identity.artist && identity.artist === identity.channel)) value += 10;
  if (/\bofficial (?:audio|music video|video|visualizer)\b/i.test(entry.title)) value += 5;
  if (/\blyrics?\b/i.test(entry.title)) value -= 5;
  return value;
}

// Why a mix entry is not used, or null. `recent` lists the identities played and queued, oldest
// first (the last ones decide the artist limit); `seed` is the identity the mix was built from.
function rejectReason(entry, { seed, recent = [], playedIds = new Set(), playedKeys = new Set() }) {
  if (!entry?.id || !entry.url) return 'invalid';
  if (entry.isLive || !Number.isFinite(entry.duration)) return 'live';
  if (entry.duration < MIN_SECONDS || entry.duration > MAX_SECONDS) return 'duration';
  const identity = trackIdentity(entry);
  if (playedIds.has(entry.id) || (seed && entry.id === seed.videoId)) return 'played';
  if (playedKeys.has(identity.key) || (seed && identity.key === seed.key)) return 'played';
  const seedMarkers = new Set(hasMarker(seed?.title || ''));
  if (hasMarker(entry.title).some((pattern) => !seedMarkers.has(pattern))) return 'keyword';
  const tail = recent.slice(-MAX_SAME_ARTIST);
  if (tail.length === MAX_SAME_ARTIST && tail.every((other) => sameArtist(identity, other))) return 'artist';
  return null;
}

// The best usable entry of a mix ({ id, title, uploader, duration, url, isLive, verified }), or null.
function pickSuggestion(entries, context) {
  let best = null;
  let bestScore = -Infinity;
  (entries || []).forEach((entry, index) => {
    if (rejectReason(entry, context)) return;
    const value = score(entry, trackIdentity(entry), index);
    if (value > bestScore) {
      best = entry;
      bestScore = value;
    }
  });
  return best;
}

module.exports = {
  MIX_SIZE,
  HISTORY_SIZE,
  SEED_COUNT,
  MIN_SECONDS,
  MAX_SECONDS,
  MAX_SAME_ARTIST,
  videoIdOf,
  trackIdentity,
  rejectReason,
  pickSuggestion
};
