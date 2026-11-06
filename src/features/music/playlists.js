const { randomBytes } = require('node:crypto');

const { MusicError, isYouTubeVideoUrl } = require('./sources');
const { parseSpotifyLink } = require('./spotify');

// Saved playlists per server and owner (data/playlists.json):
// { guilds: { <guildId>: [{ id, name, ownerId, visibility, createdAt, updatedAt, lastUsedAt, tracks: [{ title, url, duration, isLive, source?, spotifyUrl?, artists? }] }] } }
// (Spotify tracks have source 'spotify' and `url` null until their YouTube match is known.)
// Names are unique per owner (case-insensitive). Private playlists are only for their owner; public
// ones can be listed, shown and played by everyone. Only the owner changes a playlist; managers
// (`actor.isManager`: ManageGuild or PRIVILEGED_USER_IDS) may see and change every playlist.
// An actor is { id, isManager }.
const MAX_NAME_LENGTH = 50;
const MAX_PLAYLISTS_PER_USER = 25;
const MAX_PLAYLIST_TRACKS = 200;
const VISIBILITIES = ['private', 'public'];
// Autocomplete values for playlists of other members: "#<id>".
const ID_PREFIX = '#';

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nameKey(value) {
  return cleanName(value).toLowerCase();
}

function validateName(value) {
  const name = cleanName(value);
  if (!name) throw new MusicError('Give the playlist a name.');
  if (name.length > MAX_NAME_LENGTH) throw new MusicError(`Playlist names can be at most ${MAX_NAME_LENGTH} characters long.`);
  if (name.startsWith(ID_PREFIX)) throw new MusicError(`Playlist names cannot start with \`${ID_PREFIX}\`.`);
  return name;
}

function isSpotifyItem(item) {
  return item?.kind === 'spotify' || item?.source === 'spotify';
}

// A playlist entry: single YouTube videos or Spotify tracks, never radio stations. Spotify tracks
// keep { source: 'spotify', spotifyUrl, artists }; their `url` is the YouTube match once known.
function toPlaylistTrack(item) {
  if (!item || item.kind === 'radio') return null;
  if (isSpotifyItem(item)) {
    if (parseSpotifyLink(item.spotifyUrl)?.type !== 'track') return null;
    return {
      title: String(item.title || 'Unknown title').slice(0, 200),
      url: isYouTubeVideoUrl(item.url) ? item.url : null,
      duration: Number.isFinite(item.duration) ? Math.round(item.duration) : null,
      isLive: false,
      source: 'spotify',
      spotifyUrl: item.spotifyUrl,
      artists: (Array.isArray(item.artists) ? item.artists : []).map((name) => String(name).slice(0, 100)).filter(Boolean).slice(0, 10)
    };
  }
  if (!isYouTubeVideoUrl(item.url)) return null;
  return {
    title: String(item.title || 'Unknown title').slice(0, 200),
    url: item.url,
    duration: Number.isFinite(item.duration) ? Math.round(item.duration) : null,
    isLive: item.isLive === true
  };
}

function normalizePlaylist(entry) {
  const name = cleanName(entry?.name).slice(0, MAX_NAME_LENGTH);
  if (!name || !entry?.id || !entry?.ownerId) return null;
  return {
    id: String(entry.id),
    name,
    ownerId: String(entry.ownerId),
    visibility: entry.visibility === 'public' ? 'public' : 'private',
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    lastUsedAt: entry.lastUsedAt || null,
    tracks: (Array.isArray(entry.tracks) ? entry.tracks : []).map(toPlaylistTrack).filter(Boolean).slice(0, MAX_PLAYLIST_TRACKS)
  };
}

function normalizePlaylistData(data) {
  const guilds = data?.guilds && typeof data.guilds === 'object' ? data.guilds : {};
  return {
    guilds: Object.fromEntries(Object.entries(guilds).map(([guildId, list]) => [
      guildId,
      (Array.isArray(list) ? list : []).map(normalizePlaylist).filter(Boolean)
    ]))
  };
}

function isOwner(playlist, actor) {
  return playlist.ownerId === String(actor?.id);
}

function canRead(playlist, actor) {
  return playlist.visibility === 'public' || isOwner(playlist, actor) || Boolean(actor?.isManager);
}

function canEdit(playlist, actor) {
  return isOwner(playlist, actor) || Boolean(actor?.isManager);
}

// Most recently played first; never played ones after them, most recently changed first.
function byRecentUse(a, b) {
  if (Boolean(a.lastUsedAt) !== Boolean(b.lastUsedAt)) return a.lastUsedAt ? -1 : 1;
  return String(b.lastUsedAt || b.updatedAt || b.createdAt || '').localeCompare(String(a.lastUsedAt || a.updatedAt || a.createdAt || ''));
}

// `load`/`save` default to the store.js JSON helpers; without a file path the data stays in memory.
function createPlaylistStore({ filePath = null, load, save, now = () => new Date().toISOString(), createId = () => randomBytes(4).toString('hex') } = {}) {
  const jsonFiles = filePath && (!load || !save) ? require('../../storage/store') : null;
  const loadFile = load || jsonFiles?.loadJsonFile;
  const saveFile = save || jsonFiles?.saveJsonFile;
  let data = normalizePlaylistData(filePath ? loadFile(filePath, { guilds: {} }) : { guilds: {} });

  function persist() {
    if (filePath) saveFile(filePath, data);
  }

  function getAll(guildId) {
    return data.guilds[guildId] || [];
  }

  function setAll(guildId, list) {
    data = { ...data, guilds: { ...data.guilds, [guildId]: list } };
    persist();
  }

  function findOwn(guildId, ownerId, name) {
    const key = nameKey(name);
    return getAll(guildId).find((playlist) => playlist.ownerId === String(ownerId) && nameKey(playlist.name) === key) || null;
  }

  function findById(guildId, id) {
    return getAll(guildId).find((playlist) => playlist.id === String(id)) || null;
  }

  // Own playlists of the actor plus the public ones of everyone else.
  function listVisible(guildId, actor) {
    return getAll(guildId).filter((playlist) => isOwner(playlist, actor) || playlist.visibility === 'public').sort(byRecentUse);
  }

  // One member's playlists: all for the owner and managers, else only the public ones.
  function listByOwner(guildId, ownerId, actor) {
    return getAll(guildId)
      .filter((playlist) => playlist.ownerId === String(ownerId) && canRead(playlist, actor))
      .sort(byRecentUse);
  }

  function listPublic(guildId) {
    return getAll(guildId).filter((playlist) => playlist.visibility === 'public').sort(byRecentUse);
  }

  function notFound(name, ownerId) {
    const shown = cleanName(name).slice(0, MAX_NAME_LENGTH);
    return new MusicError(ownerId
      ? `<@${ownerId}> has no public playlist called **${shown}**.`
      : `You have no playlist called **${shown}**. Add \`user:\` for someone else's public playlist.`);
  }

  // Resolves `name` for reading: "#<id>" (autocomplete), the playlist of `ownerId` when given,
  // else the actor's own one. Private playlists of others look like missing ones.
  function resolve(guildId, actor, name, ownerId = null) {
    const text = cleanName(name);
    let playlist = null;
    if (text.startsWith(ID_PREFIX)) playlist = findById(guildId, text.slice(ID_PREFIX.length));
    else playlist = findOwn(guildId, ownerId || actor.id, text);
    if (!playlist || !canRead(playlist, actor)) throw notFound(text, ownerId && String(ownerId) !== String(actor.id) ? ownerId : null);
    return playlist;
  }

  function resolveEditable(guildId, actor, name, ownerId = null) {
    const playlist = resolve(guildId, actor, name, ownerId);
    if (!canEdit(playlist, actor)) throw new MusicError(`Only <@${playlist.ownerId}> or a server manager can change **${playlist.name}**.`);
    return playlist;
  }

  function update(guildId, id, patch) {
    let updated = null;
    setAll(guildId, getAll(guildId).map((playlist) => {
      if (playlist.id !== id) return playlist;
      updated = { ...playlist, ...patch };
      return updated;
    }));
    return updated;
  }

  // Throws when the actor cannot create a playlist with this name; returns the clean name.
  function assertCanCreate(guildId, actor, rawName) {
    const name = validateName(rawName);
    if (findOwn(guildId, actor.id, name)) throw new MusicError(`You already have a playlist called **${name}**.`);
    if (getAll(guildId).filter((playlist) => isOwner(playlist, actor)).length >= MAX_PLAYLISTS_PER_USER) {
      throw new MusicError(`You already have ${MAX_PLAYLISTS_PER_USER} playlists. Delete one first.`);
    }
    return name;
  }

  function create(guildId, actor, rawName, tracks = [], { visibility = 'private' } = {}) {
    const name = assertCanCreate(guildId, actor, rawName);
    let id = createId();
    while (findById(guildId, id)) id = createId();
    const time = now();
    const playlist = {
      id,
      name,
      ownerId: String(actor.id),
      visibility: VISIBILITIES.includes(visibility) ? visibility : 'private',
      createdAt: time,
      updatedAt: time,
      lastUsedAt: null,
      tracks: tracks.map(toPlaylistTrack).filter(Boolean).slice(0, MAX_PLAYLIST_TRACKS)
    };
    setAll(guildId, [...getAll(guildId), playlist]);
    return playlist;
  }

  function remove(guildId, actor, name) {
    const playlist = resolveEditable(guildId, actor, name);
    setAll(guildId, getAll(guildId).filter((entry) => entry.id !== playlist.id));
    return playlist;
  }

  function rename(guildId, actor, name, rawNewName) {
    const playlist = resolveEditable(guildId, actor, name);
    const newName = validateName(rawNewName);
    const clash = findOwn(guildId, playlist.ownerId, newName);
    if (clash && clash.id !== playlist.id) throw new MusicError(`There already is a playlist called **${newName}**.`);
    return update(guildId, playlist.id, { name: newName, updatedAt: now() });
  }

  function setVisibility(guildId, actor, name, visibility) {
    if (!VISIBILITIES.includes(visibility)) throw new MusicError('Visibility must be public or private.');
    const playlist = resolveEditable(guildId, actor, name);
    return update(guildId, playlist.id, { visibility, updatedAt: now() });
  }

  // Copies a playlist the actor can read into a new private playlist of the actor.
  function copy(guildId, actor, name, ownerId, rawNewName) {
    const source = resolve(guildId, actor, name, ownerId);
    return create(guildId, actor, rawNewName || source.name, source.tracks);
  }

  // Appends up to the track limit; returns { playlist, added, dropped }.
  function addTracks(guildId, actor, name, items) {
    const playlist = resolveEditable(guildId, actor, name);
    const tracks = items.map(toPlaylistTrack).filter(Boolean);
    if (!tracks.length) throw new MusicError('Only single YouTube videos and Spotify tracks can be saved in a playlist.');
    const room = MAX_PLAYLIST_TRACKS - playlist.tracks.length;
    if (room <= 0) throw new MusicError(`**${playlist.name}** is full (${MAX_PLAYLIST_TRACKS} tracks).`);
    const added = tracks.slice(0, room);
    const updated = update(guildId, playlist.id, { tracks: [...playlist.tracks, ...added], updatedAt: now() });
    return { playlist: updated, added: added.length, dropped: tracks.length - added.length };
  }

  function removeTrack(guildId, actor, name, position) {
    const playlist = resolveEditable(guildId, actor, name);
    if (!Number.isInteger(position) || position < 1 || position > playlist.tracks.length) {
      throw new MusicError(`**${playlist.name}** has no track ${position}; it has ${playlist.tracks.length}.`);
    }
    const tracks = [...playlist.tracks];
    const [removed] = tracks.splice(position - 1, 1);
    return { playlist: update(guildId, playlist.id, { tracks, updatedAt: now() }), removed };
  }

  // Creates the actor's playlist or replaces the tracks of their existing one with that name.
  // Returns { playlist, created, dropped }.
  function saveTracks(guildId, actor, rawName, items) {
    const tracks = items.map(toPlaylistTrack).filter(Boolean);
    if (!tracks.length) throw new MusicError('There are no YouTube or Spotify tracks to save.');
    const kept = tracks.slice(0, MAX_PLAYLIST_TRACKS);
    const existing = findOwn(guildId, actor.id, validateName(rawName));
    if (!existing) return { playlist: create(guildId, actor, rawName, kept), created: true, dropped: tracks.length - kept.length };
    return { playlist: update(guildId, existing.id, { tracks: kept, updatedAt: now() }), created: false, dropped: tracks.length - kept.length };
  }

  function markUsed(guildId, id) {
    return update(guildId, id, { lastUsedAt: now() });
  }

  // Remembers the YouTube match of a Spotify track in every playlist of the server that has it unresolved.
  function cacheResolvedUrl(guildId, spotifyUrl, url) {
    if (!spotifyUrl || !isYouTubeVideoUrl(url)) return 0;
    let changed = 0;
    const list = getAll(guildId).map((playlist) => {
      if (!playlist.tracks.some((track) => track.spotifyUrl === spotifyUrl && !track.url)) return playlist;
      changed += 1;
      return { ...playlist, tracks: playlist.tracks.map((track) => (track.spotifyUrl === spotifyUrl && !track.url ? { ...track, url } : track)) };
    });
    if (changed) setAll(guildId, list);
    return changed;
  }

  // Autocomplete: own playlists first (value = name), then other public ones (value = "#<id>").
  // `editable` limits it to playlists the actor may change.
  function suggest(guildId, actor, query = '', { editable = false } = {}) {
    const key = nameKey(query);
    const matches = getAll(guildId)
      .filter((playlist) => (editable ? canEdit(playlist, actor) : canRead(playlist, actor)) && nameKey(playlist.name).includes(key))
      .sort(byRecentUse);
    const own = matches.filter((playlist) => isOwner(playlist, actor)).map((playlist) => ({ playlist, own: true, value: playlist.name }));
    const others = matches.filter((playlist) => !isOwner(playlist, actor)).map((playlist) => ({ playlist, own: false, value: `${ID_PREFIX}${playlist.id}` }));
    return [...own, ...others];
  }

  return {
    findById,
    findOwn,
    assertCanCreate,
    listVisible,
    listByOwner,
    listPublic,
    resolve,
    resolveEditable,
    create,
    remove,
    rename,
    setVisibility,
    copy,
    addTracks,
    removeTrack,
    saveTracks,
    markUsed,
    cacheResolvedUrl,
    suggest
  };
}

module.exports = {
  MAX_NAME_LENGTH,
  MAX_PLAYLISTS_PER_USER,
  MAX_PLAYLIST_TRACKS,
  createPlaylistStore,
  normalizePlaylistData,
  toPlaylistTrack,
  validateName,
  canRead,
  canEdit
};
