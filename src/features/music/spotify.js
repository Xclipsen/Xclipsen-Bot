const { MusicError } = require('./sources');

// Spotify audio is DRM-protected, so the bot only reads track metadata from a Spotify link and
// plays the best YouTube match through yt-dlp.
//
// Two ways to read the metadata:
// - Web API with the Client Credentials flow (SPOTIFY_CLIENT_ID/SECRET). Gives album names, ISRCs
//   and full album pagination. Since Feb 2026 new Development Mode apps get no playlist items
//   (only playlists the *user* owns, and Client Credentials has no user), no artist top tracks,
//   and Spotify-owned editorial playlists answer 404 since Nov 2024.
// - The public embed page open.spotify.com/embed/{type}/{id}: no credentials, its __NEXT_DATA__
//   JSON lists up to 100 tracks (title, artists, duration), also for editorial playlists, and the
//   artist page lists the 10 top tracks. Not an official API, so its shape can change.
// The Web API is tried first when configured; anything it can't read falls back to the embed page.
const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const EMBED_BASE = 'https://open.spotify.com/embed';
const REQUEST_TIMEOUT_MS = 10_000;
// The embed page never lists more than this many tracks.
const EMBED_TRACK_CAP = 100;
const MAX_LIMIT = 500;
const MAX_SHORT_LINK_HOPS = 3;
const TYPES = new Set(['track', 'album', 'playlist', 'artist']);
const OPEN_HOSTS = new Set(['open.spotify.com', 'play.spotify.com']);
const SHORT_HOSTS = new Set(['spotify.link', 'spotify.app.link']);
// Short links may hop through these before landing on open.spotify.com.
const REDIRECT_HOSTS = new Set([...OPEN_HOSTS, ...SHORT_HOSTS, 'spotify.com', 'www.spotify.com']);
const ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en'
};

class SpotifyError extends MusicError {}

class SpotifyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toUrl(input) {
  const text = String(input || '').trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

// open.spotify.com links and spotify: URIs; short links need parseSpotifyUrl().
function parseSpotifyLink(input) {
  const text = String(input || '').trim();
  const uri = text.match(/^spotify:(?:user:[^:\s]+:)?([a-z]+):([A-Za-z0-9]{22})$/i);
  if (uri) {
    const type = uri[1].toLowerCase();
    return TYPES.has(type) ? { type, id: uri[2] } : null;
  }
  if (!/^(https?:\/\/)?[\w.-]*spotify\.com\//i.test(text)) return null;
  const url = toUrl(text);
  if (!url || !OPEN_HOSTS.has(url.hostname.toLowerCase())) return null;
  // /intl-de/track/{id}, /embed/track/{id}, legacy /user/{name}/playlist/{id}
  const parts = url.pathname.split('/').filter(Boolean);
  if (/^intl-[a-z-]+$/i.test(parts[0] || '')) parts.shift();
  if (parts[0] === 'embed') parts.shift();
  if (parts[0] === 'user' && parts.length >= 4) parts.splice(0, 2);
  const [type, id] = parts;
  return parts.length === 2 && TYPES.has(type) && ID_PATTERN.test(id) ? { type, id } : null;
}

function isShortLink(input) {
  const text = String(input || '').trim();
  if (!/^(https?:\/\/)?spotify\.(app\.)?link\//i.test(text)) return false;
  const url = toUrl(text);
  return Boolean(url && SHORT_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.length > 1);
}

// Anything that looks like a Spotify link (also podcasts or unknown paths), for routing /music.
function isSpotifyLink(input) {
  const text = String(input || '').trim();
  if (/^spotify:/i.test(text) || isShortLink(text)) return true;
  if (!/^(https?:\/\/)?[\w.-]*spotify\.com\//i.test(text)) return false;
  const url = toUrl(text);
  return Boolean(url && OPEN_HOSTS.has(url.hostname.toLowerCase()));
}

const JUNK_SUFFIX = /\s+-\s+(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?|(?:mono|stereo)(?:\s+(?:version|mix))?|(?:single|album|original|explicit|clean)\s+version|(?:\d+(?:st|nd|rd|th)\s+)?anniversary\s+(?:edition|version|remaster)|(?:deluxe|expanded|bonus\s+track)(?:\s+(?:edition|version))?|from\s+.+)$/i;
const JUNK_BRACKET = /\s*[([](?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?|(?:mono|stereo)(?:\s+version)?|(?:single|album|original)\s+version|(?:deluxe|expanded)(?:\s+(?:edition|version))?|from\s+[^)\]]+)[)\]]/gi;
const FEAT_PART = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s+-\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/gi;

function normalize(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text).split(' ').filter(Boolean);
}

// Removes remaster/version noise and feat. credits from a Spotify title; returns the featured names too.
function cleanTitle(title) {
  const featured = [];
  let text = String(title || '').replace(FEAT_PART, (match, inBracket, afterDash) => {
    featured.push(...String(inBracket || afterDash).split(/\s*(?:,|&)\s*/).filter(Boolean));
    return '';
  });
  let previous;
  do {
    previous = text;
    text = text.replace(JUNK_BRACKET, '').replace(JUNK_SUFFIX, '').trim();
  } while (text !== previous);
  return { title: text || String(title || '').trim(), featured };
}

// "Artist1, Artist2 - Title"; featured artists from the title are listed once, at most 3 artists.
function toSearchQuery(track) {
  const { title, featured } = cleanTitle(track?.title);
  const artists = [];
  for (const name of [...(track?.artists || []), ...featured]) {
    const clean = String(name || '').trim();
    if (clean && !artists.some((known) => normalize(known) === normalize(clean))) artists.push(clean);
  }
  const list = artists.slice(0, 3).join(', ');
  return list ? `${list} - ${title}` : title;
}

// Words that mark a different version of a song; penalised unless the Spotify title has them too.
const VERSION_MARKERS = [
  ['live', /\blive\b/], ['cover', /\bcover\b/], ['remix', /\bremix(?:ed)?\b/], ['sped up', /\bsped up\b|\bspeed up\b/],
  ['slowed', /\bslowed\b/], ['nightcore', /\bnightcore\b/], ['8d', /\b8d\b/], ['reaction', /\breact(?:ion|s|ing)?\b/],
  ['karaoke', /\bkaraoke\b/], ['instrumental', /\binstrumental\b/], ['acoustic', /\bacoustic\b/],
  ['reverb', /\breverb\b/], ['bass boosted', /\bbass boost(?:ed)?\b/], ['loop', /\b\d+\s+hours?\b|\bloop\b/],
  ['tutorial', /\btutorial\b|\blesson\b|\bhow to play\b/], ['piano', /\bpiano (?:version|cover)\b/]
];
const MIN_MATCH_SCORE = 30;

function durationScore(trackSeconds, candidateSeconds) {
  if (!trackSeconds || !Number.isFinite(candidateSeconds) || candidateSeconds <= 0) return 0;
  const diff = Math.abs(candidateSeconds - trackSeconds);
  if (diff <= 3) return 30;
  if (diff <= 10) return 25;
  if (diff <= 20) return 10;
  if (diff <= 40) return 0;
  // Way off (extended mix, full album, 10-hour loop).
  return diff > Math.max(60, trackSeconds * 0.25) ? -50 : -20;
}

function scoreCandidate(track, candidate) {
  const { title } = cleanTitle(track?.title);
  const spotifyText = normalize(`${track?.title || ''} ${track?.album || ''}`);
  const candidateTitle = normalize(candidate?.title);
  const uploader = String(candidate?.uploader || '');
  const uploaderNorm = normalize(uploader.replace(/\s+-\s+topic$/i, ''));
  const haystack = new Set(tokens(`${candidate?.title || ''} ${uploader}`));

  let score = durationScore((track?.durationMs || 0) / 1000, Number(candidate?.duration));

  const titleTokens = tokens(title);
  if (titleTokens.length) score += 40 * titleTokens.filter((token) => haystack.has(token)).length / titleTokens.length;

  const artists = (track?.artists || []).map(normalize).filter(Boolean);
  const artistFound = (artist) => artist.split(' ').every((token) => haystack.has(token));
  if (artists.length) {
    if (artistFound(artists[0])) score += 20;
    if (artists.length > 1) score += 5 * artists.slice(1).filter(artistFound).length / (artists.length - 1);
  }

  // Auto-generated "Artist - Topic" channels carry the studio recording; VEVO/official channels next.
  const isArtistChannel = artists.some((artist) => artist === uploaderNorm);
  if (/\s-\s+topic$/i.test(uploader) && isArtistChannel) score += 20;
  else if (/\s-\s+topic$/i.test(uploader)) score += 5;
  else if (isArtistChannel || /vevo$/i.test(uploader.replace(/\s/g, '')) || /\bofficial\b/i.test(uploader)) score += 10;
  if (/\bofficial (?:audio|music video|video|lyric video|visualizer)\b/.test(candidateTitle)) score += 5;

  for (const [, pattern] of VERSION_MARKERS) {
    if (pattern.test(candidateTitle) && !pattern.test(spotifyText)) score -= 30;
  }
  return score;
}

// Best yt-dlp search result ({ title, uploader, duration, url }) for a Spotify track, or null.
function pickBestMatch(track, candidates) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates || []) {
    if (!candidate?.url) continue;
    const score = scoreCandidate(track, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

function spotifyUrlFor(type, id) {
  return `https://open.spotify.com/${type}/${id}`;
}

function idFromUri(uri) {
  const match = String(uri || '').match(/^spotify:([a-z]+):([A-Za-z0-9]{22})$/);
  return match ? { type: match[1], id: match[2] } : null;
}

function clampLimit(limit) {
  const value = Number.parseInt(limit, 10);
  return Number.isFinite(value) ? Math.min(MAX_LIMIT, Math.max(1, value)) : 100;
}

const NOUNS = { track: 'track', album: 'album', playlist: 'playlist', artist: 'artist' };

function createSpotifyResolver({ clientId, clientSecret, fetchImpl = fetch, now = Date.now } = {}) {
  const hasCredentials = Boolean(clientId && clientSecret);
  let token = null;
  let tokenPromise = null;

  function request(url, options = {}) {
    return fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  // Resolves spotify.link / spotify.app.link short links, only following redirects on Spotify domains.
  async function parseSpotifyUrl(input) {
    const direct = parseSpotifyLink(input);
    if (direct || !isShortLink(input)) return direct;

    let url = toUrl(input);
    for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop += 1) {
      let response;
      try {
        response = await request(url.href, { method: 'GET', redirect: 'manual', headers: BROWSER_HEADERS });
      } catch {
        throw new SpotifyError('Could not open that Spotify short link.');
      }
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        let next;
        try {
          next = new URL(location, url);
        } catch {
          return null;
        }
        if (next.protocol !== 'https:' || !REDIRECT_HOSTS.has(next.hostname.toLowerCase())) return null;
        const parsed = parseSpotifyLink(next.href);
        if (parsed) return parsed;
        if (!SHORT_HOSTS.has(next.hostname.toLowerCase())) return null;
        url = next;
        continue;
      }
      // spotify.app.link sometimes answers with an HTML page that redirects in JavaScript.
      if (response.ok) {
        const body = await response.text().catch(() => '');
        const target = body.match(/https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:track|album|playlist|artist)\/[A-Za-z0-9]{22}/i);
        return target ? parseSpotifyLink(target[0]) : null;
      }
      return null;
    }
    return null;
  }

  async function fetchToken() {
    let response;
    try {
      response = await request(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });
    } catch (error) {
      throw new SpotifyApiError(0, `Spotify token request failed: ${error.message}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new SpotifyApiError(response.status, `Spotify token request failed (${response.status}): ${data.error_description || data.error || 'no token'}`);
    }
    // Renew a minute early.
    token = { value: data.access_token, expiresAt: now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000 };
    return token.value;
  }

  async function getToken() {
    if (token && now() < token.expiresAt) return token.value;
    tokenPromise ||= fetchToken().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function api(pathOrUrl, retried = false) {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    if (!url.startsWith(`${API_BASE}/`)) throw new SpotifyApiError(0, `Refusing to follow ${url}`);
    let response;
    try {
      response = await request(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
    } catch (error) {
      if (error instanceof SpotifyApiError) throw error;
      throw new SpotifyApiError(0, `Spotify API request failed: ${error.message}`);
    }
    if (response.status === 401 && !retried) {
      token = null;
      return api(pathOrUrl, true);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new SpotifyApiError(response.status, `Spotify API ${response.status}: ${data.error?.message || response.statusText || 'error'}`);
    }
    return response.json();
  }

  function apiTrack(item, albumName) {
    const id = item.id || idFromUri(item.uri)?.id;
    return {
      title: String(item.name || 'Unknown title'),
      artists: (item.artists || []).map((artist) => artist.name).filter(Boolean),
      ...((item.album?.name || albumName) && { album: item.album?.name || albumName }),
      durationMs: Number(item.duration_ms) || 0,
      ...(item.external_ids?.isrc && { isrc: item.external_ids.isrc }),
      spotifyUrl: item.external_urls?.spotify || (id ? spotifyUrlFor('track', id) : null)
    };
  }

  // Walks `next` links until `limit` tracks are collected.
  async function collectPages(firstPage, limit, toTrack) {
    const tracks = [];
    let page = firstPage || { items: [] };
    for (;;) {
      for (const entry of page.items || []) {
        const track = toTrack(entry);
        if (track) tracks.push(track);
      }
      if (tracks.length >= limit || !page.next) break;
      page = await api(page.next);
    }
    return { tracks: tracks.slice(0, limit), truncated: tracks.length > limit || Boolean(page.next) };
  }

  async function resolveWithApi(type, id, limit) {
    if (type === 'track') {
      const track = await api(`/tracks/${id}`);
      return { kind: 'track', name: track.name, tracks: [apiTrack(track)], truncated: false };
    }
    if (type === 'album') {
      const album = await api(`/albums/${id}`);
      const { tracks, truncated } = await collectPages(album.tracks, limit, (item) => (item?.id || item?.uri ? apiTrack(item, album.name) : null));
      return { kind: 'album', name: album.name, owner: (album.artists || []).map((artist) => artist.name).join(', '), tracks, truncated };
    }
    if (type === 'playlist') {
      const playlist = await api(`/playlists/${id}`);
      // Feb 2026 renamed tracks → items and track → item; restricted apps get no items at all.
      const firstPage = playlist.items || playlist.tracks;
      if (!firstPage || !Array.isArray(firstPage.items)) throw new SpotifyApiError(403, 'Playlist items are not available to this app');
      const { tracks, truncated } = await collectPages(firstPage, limit, (entry) => {
        const item = entry?.item || entry?.track;
        return item && !item.is_local && (item.type || 'track') === 'track' && item.id ? apiTrack(item) : null;
      });
      return { kind: 'playlist', name: playlist.name, owner: playlist.owner?.display_name || undefined, tracks, truncated };
    }
    // Artist top tracks were removed for new Development Mode apps (Feb 2026); older apps still have them.
    const [artist, top] = await Promise.all([api(`/artists/${id}`), api(`/artists/${id}/top-tracks?market=US`)]);
    const tracks = (top.tracks || []).map((item) => apiTrack(item));
    return { kind: 'artist', name: artist.name, tracks: tracks.slice(0, limit), truncated: tracks.length > limit };
  }

  function readEmbedData(html) {
    const match = String(html).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  async function resolveWithEmbed(type, id, limit) {
    let response;
    try {
      response = await request(`${EMBED_BASE}/${type}/${id}`, { headers: BROWSER_HEADERS });
    } catch (error) {
      throw new Error(`Spotify embed request failed: ${error.message}`);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Spotify embed page answered ${response.status}`);
    const data = readEmbedData(await response.text());
    const pageProps = data?.props?.pageProps;
    if (pageProps?.status === 404) return null;
    const entity = pageProps?.state?.data?.entity;
    if (!entity || entity.type !== type) throw new Error('Spotify embed page has an unknown format');

    const name = String(entity.name || entity.title || 'Unknown');
    if (type === 'track') {
      return {
        kind: 'track',
        name,
        tracks: [{
          title: name,
          artists: (entity.artists || []).map((artist) => artist.name).filter(Boolean),
          durationMs: Number(entity.duration) || 0,
          spotifyUrl: spotifyUrlFor('track', id)
        }],
        truncated: false
      };
    }

    const list = (entity.trackList || [])
      .filter((item) => (item.entityType || 'track') === 'track' && idFromUri(item.uri)?.type === 'track')
      .map((item) => ({
        title: String(item.title || 'Unknown title'),
        // The embed joins artists with ", "; names that contain a comma get split, which search tolerates.
        artists: String(item.subtitle || '').split(', ').map((artist) => artist.trim()).filter(Boolean),
        ...(type === 'album' && { album: name }),
        durationMs: Number(item.duration) || 0,
        spotifyUrl: spotifyUrlFor('track', idFromUri(item.uri).id)
      }));
    return {
      kind: type,
      name,
      ...(type !== 'artist' && entity.subtitle && { owner: String(entity.subtitle) }),
      tracks: list.slice(0, limit),
      // The embed stops at 100 tracks, so a full page may be cut off.
      truncated: list.length > limit || (type !== 'artist' && list.length >= EMBED_TRACK_CAP)
    };
  }

  function unreadableError(type, id, apiError) {
    if (type === 'playlist' && id.startsWith('37i9dQZF') && apiError?.status === 404) {
      return new SpotifyError('Spotify-owned editorial and algorithmic playlists can\'t be read by bots.');
    }
    if (!hasCredentials) {
      return new SpotifyError(`Could not read that Spotify ${NOUNS[type]} right now. Setting SPOTIFY_CLIENT_ID/SECRET lets the bot use the Spotify Web API instead.`);
    }
    return new SpotifyError(`Could not read that Spotify ${NOUNS[type]} right now. Please try again later.`);
  }

  // Track metadata for a Spotify link: { kind, name, owner?, tracks, truncated, source }.
  async function resolve(input, { limit = 100 } = {}) {
    const parsed = await parseSpotifyUrl(input);
    if (!parsed) {
      if (isShortLink(input)) throw new SpotifyError('That Spotify short link doesn\'t lead to a track, album, playlist or artist.');
      throw new SpotifyError(isSpotifyLink(input)
        ? 'Only Spotify tracks, albums, playlists and artists work, not podcasts or other pages.'
        : 'That is not a Spotify link.');
    }
    const { type, id } = parsed;
    const max = clampLimit(limit);

    let apiError = null;
    if (hasCredentials) {
      try {
        return { ...(await resolveWithApi(type, id, max)), source: 'api' };
      } catch (error) {
        apiError = error;
        console.warn(`Spotify Web API could not read ${type} ${id}, trying the embed page:`, error.message);
      }
    }

    let result;
    try {
      result = await resolveWithEmbed(type, id, max);
    } catch (error) {
      console.error(`Spotify embed page failed for ${type} ${id}:`, error.message);
      throw unreadableError(type, id, apiError);
    }
    if (!result) {
      throw new SpotifyError(type === 'playlist'
        ? 'That Spotify playlist doesn\'t exist or is private.'
        : `That Spotify ${NOUNS[type]} doesn't exist or isn't available.`);
    }
    if (!result.tracks.length) throw new SpotifyError(`That Spotify ${NOUNS[type]} has no playable tracks.`);
    return { ...result, source: 'embed' };
  }

  return { parseSpotifyUrl, resolve, toSearchQuery, pickBestMatch, hasCredentials };
}

module.exports = {
  createSpotifyResolver,
  parseSpotifyLink,
  isSpotifyLink,
  toSearchQuery,
  pickBestMatch,
  scoreCandidate,
  cleanTitle,
  SpotifyError,
  EMBED_TRACK_CAP
};
