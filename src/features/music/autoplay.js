const { cleanTitle, normalize, VERSION_MARKERS } = require('./spotify');

// Autoplay picks songs related to what was played from the "radio" playlist YouTube builds for a
// video. YouTube Music's radio (list=RDAMVM<id>) keeps closer to music-only uploads (fewer lyric
// re-uploads, EPs and "mix" videos); the plain YouTube Mix (list=RD<id>) is the fallback. Both are
// read with one flat yt-dlp lookup of the first MIX_SIZE entries (see sources.fetchMix). Flat
// entries carry no reliable "verified" flag and YouTube Music radios list few "- Topic" uploads,
// so scoring mostly trusts the order of the mix and channels named like the artist.
const MIX_SIZE = 25;
const HISTORY_SIZE = 50;
const SEED_COUNT = 3;
const MIN_SECONDS = 60;
const MAX_SECONDS = 10 * 60;
// At most this many tracks in a row by the same artist or channel.
const MAX_SAME_ARTIST = 2;

// Version tags that leave the song as it is ("Animals (Original Mix)", "Song - Radio Edit").
const NEUTRAL_TAG = /\s*[([](?:original|extended|radio|club|album|single|main)\s+(?:mix|edit|version)[)\]]|\s+[-–—]\s+(?:original|extended|radio|club|album|single|main)\s+(?:mix|edit|version)\s*$/gi;
// Words that are normal in song titles ("Best Of You", "Live Forever") and only mark a non-song
// in a title's decoration: brackets, or after " | ", " / ", " // ", " ~ ", " • " or a second " - ".
const DECORATION_MARKERS = [
  /\blive\b/, /\bmix\b/, /\bbest of\b/, /\bplaylist\b/, /\bcompilation\b/, /\bloop\b/, /\bstream(?:ing)?\b/,
  /\b(?:full )?(?:album|ep)\b/
];
// Phrases of compilations and channels that collect songs, in the title itself (not in genre tags
// like "[lofi hip hop beats]"); only when the channel is not the artist.
const COMPILATION_PHRASES = [
  /\bsongs for\b/, /\bbeats to\b/, /\bmusic for\b/, /\bstudy music\b/, /\bchill beats\b/,
  /\b(?:lo ?fi|hip ?hop|chill|study|sleep|relaxing|jazz|piano) (?:mix|radio|playlist|beats)\b/,
  /\bplaylist\b/, /\bcompilation\b/, /\b(?:19|20)\d\d mix\b|\bmix (?:19|20)\d\d\b/, /\bbest of (?:19|20)\d\d\b/
];
// In the title itself, whoever uploaded it: "Phoenix EP", "Full Album".
const MAIN_MARKERS = [/\bep$/, /\bfull (?:album|ep)\b/];
// Anywhere in a title: hour-long loops and the Spotify penalty words (cover, nightcore, sped up,
// reaction, 8d, …; "live" and "loop" only as decoration, see above).
const ANYWHERE_MARKERS = [
  /\b\d+\s*(?:hours?|hrs?)\b/, /\bgreatest hits\b/, /\btop \d+\b/, /\bnon ?stop\b/, /\bmegamix\b/, /\bmashup\b/,
  ...VERSION_MARKERS.filter(([name]) => name !== 'live' && name !== 'loop').map(([, pattern]) => pattern)
];
const DASH = /\s+[-–—]\s+/;
const BRACKETS = /[([{【「『]([^)\]}】」』]*)[)\]}】」』]/g;
const SEPARATOR = /\s+(?:\||\/\/?|~|•)\s+/;
const CHANNEL_NOISE = /\s+-\s+topic$|vevo$|\bofficial\b/gi;
const TOPIC = /\s-\s+topic$/i;

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
  return String(text || '').split(/\s*(?:,|&|\bx\b|\bvs\.?(?=\s)|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b|\bwith\b)\s*/i).find(Boolean) || '';
}

function stripNeutralTags(title) {
  return String(title || '').replace(NEUTRAL_TAG, '');
}

// Title without brackets, feat./prod. credits and trailing "Official Video"-like tags.
function songPart(text) {
  const { title } = cleanTitle(String(text || '').replace(BRACKETS, ' '));
  return normalize(title
    .replace(/\s+\b(?:prod|produced)\.?\s+(?:by\s+)?.*$/i, '')
    .replace(/\s+\b(?:feat|ft|featuring)\.?\s+.*$/i, '')
    .replace(/\s+(?:official\s+)?(?:music\s+video|lyric\s+video|video|audio|visualizer|lyrics)\s*$/i, ''));
}

// { videoId, key, artist, channel, title, artistIsChannel } of a queue item or mix entry. `key` is
// the normalized "artist - title", so re-uploads of a song count as the same song.
function trackIdentity(item) {
  const title = String(item?.title || '');
  const uploader = String(item?.author ?? item?.uploader ?? '');
  const channel = channelName(uploader);
  let artist;
  let song;
  let fromTitle = false;
  if (Array.isArray(item?.artists) && item.artists.length) {
    artist = normalize(firstArtist(item.artists[0]));
    song = songPart(stripNeutralTags(title));
    fromTitle = true;
  } else {
    const parts = stripNeutralTags(title).replace(BRACKETS, ' ').split(DASH);
    if (parts.length >= 2) {
      let [left, ...rest] = parts;
      let right = rest.join(' - ');
      // "In The End [Official Video] - Linkin Park"
      if (channel && normalize(firstArtist(right)) === channel && normalize(firstArtist(left)) !== channel) [left, right] = [right, left];
      artist = normalize(firstArtist(left));
      song = songPart(right.split(DASH)[0]);
      fromTitle = true;
    } else {
      artist = channel;
      song = songPart(stripNeutralTags(title));
    }
  }
  return {
    videoId: videoIdOf(item?.url) || (typeof item?.id === 'string' ? item.id : null),
    key: `${artist} - ${song || normalize(title)}`,
    artist,
    channel,
    title,
    artistIsChannel: TOPIC.test(uploader) || Boolean(fromTitle && artist && artist === channel)
  };
}

// The parts of a title that describe the upload rather than name the song.
function decorationOf(title) {
  const parts = [];
  let main = stripNeutralTags(title).replace(BRACKETS, (match, inner) => {
    parts.push(inner);
    return ' ';
  });
  const [first, ...afterSeparator] = main.split(SEPARATOR);
  parts.push(...afterSeparator);
  main = first;
  const dashes = main.split(DASH);
  parts.push(...dashes.slice(2));
  return { main: dashes.slice(0, 2).join(' - '), decoration: normalize(parts.join(' ')) };
}

// Names of the markers a title has; `strict` (the seed) also counts them anywhere in the title.
function markersOf(title, { artistIsChannel = false, strict = false } = {}) {
  const { main, decoration } = decorationOf(title);
  const whole = normalize(stripNeutralTags(title));
  const found = new Set();
  DECORATION_MARKERS.forEach((pattern, index) => {
    if (pattern.test(decoration) || (strict && pattern.test(whole))) found.add(`d${index}`);
  });
  const mainText = normalize(main);
  COMPILATION_PHRASES.forEach((pattern, index) => {
    if ((!artistIsChannel || strict) && pattern.test(strict ? whole : mainText)) found.add(`c${index}`);
  });
  MAIN_MARKERS.forEach((pattern, index) => {
    if (pattern.test(strict ? whole : mainText)) found.add(`m${index}`);
  });
  ANYWHERE_MARKERS.forEach((pattern, index) => {
    if (pattern.test(whole)) found.add(`a${index}`);
  });
  return found;
}

function sameArtist(a, b) {
  return Boolean((a.artist && (a.artist === b.artist || a.artist === b.channel))
    || (a.channel && (a.channel === b.channel || a.channel === b.artist)));
}

// Earlier entries of the mix are closer to the seed; uploads by the artist's own channel win.
function score(entry, identity, index) {
  const uploader = String(entry.uploader || '');
  let value = MIX_SIZE - index;
  if (identity.artistIsChannel) value += 6;
  else if (/vevo$/i.test(uploader.replace(/\s/g, '')) || /\bofficial\b/i.test(uploader)) value += 3;
  if (/\bofficial (?:audio|music video|video|visualizer)\b/i.test(entry.title)) value += 2;
  if (/\blyrics?\b/i.test(entry.title)) value -= 4;
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
  const seedMarkers = markersOf(seed?.title || '', { strict: true });
  if ([...markersOf(entry.title, identity)].some((marker) => !seedMarkers.has(marker))) return 'keyword';
  const tail = recent.slice(-MAX_SAME_ARTIST);
  if (tail.length === MAX_SAME_ARTIST && tail.every((other) => sameArtist(identity, other))) return 'artist';
  return null;
}

// The best usable entry of a mix ({ id, title, uploader, duration, url, isLive }), or null.
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
