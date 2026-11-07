const { ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');

const dns = require('node:dns');

const { createMusicSources, MusicError, MAX_IMPORT_TRACKS } = require('./sources');
const { listStations, findStation } = require('./stations');
const {
  PANEL_IDS,
  PAGE_PREFIX,
  buildPanelMessage,
  buildQueueView,
  buildPlaylistView,
  buildPlaylistListView,
  describeItem,
  describeLength,
  describeRequester,
  describeSource,
  displayTitle,
  escapeMarkdown,
  formatDuration,
  shorten
} = require('./panel');
const { assertPublicStationUrl } = require('./urlSafety');
const { nextLoopMode, shuffled, removeAt, moveItem, LOOP_MODES } = require('./queue');
const { createPlaylistStore, canRead, MAX_PLAYLIST_TRACKS } = require('./playlists');
const { createResumeStore } = require('./resume');
const { createSpotifyResolver, isSpotifyLink } = require('./spotify');
const { HISTORY_SIZE, SEED_COUNT, trackIdentity, pickSuggestion } = require('./autoplay');

const MAX_QUEUE = 50;
// Playlists (and /music continue) may fill the queue further.
const MAX_PLAYLIST_QUEUE = 100;
const VOLUME_STEP = 10;
// yt-dlp lookups from commands: one per server at a time, three across all servers. Background
// Spotify matches use their own slots (one per server, two overall) so they never block commands.
const MAX_LOOKUPS = 3;
const MAX_BACKGROUND_LOOKUPS = 2;
// After this many Spotify tracks in a row without a match the rest of such a run is skipped at once.
const MAX_MATCH_FAILURES = 3;
// A track that ended this quickly failed (or was removed); loops skip it instead of retrying forever.
const MIN_LOOP_PLAY_MS = 3_000;
// Channel cleanup: bulk delete only works for messages younger than 14 days.
const BULK_DELETE_MAX_AGE_MS = (14 * 24 * 60 - 60) * 60_000;
const CLEANUP_MAX_PAGES = 5;
// Messages older than 14 days are deleted one by one; at most this many per cleanup.
const MAX_SINGLE_DELETES = 20;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;
const PANEL_CUSTOM_IDS = new Set(Object.values(PANEL_IDS));
// The skip button carries the play token of the track it was shown for: music-panel:skip:<token>.
const SKIP_PREFIX = `${PANEL_IDS.skip}:`;
// Autoplay tries this many seeds (each with both mix sources) before it stops for the session.
const MAX_AUTOPLAY_ATTEMPTS = 3;
const AUTOPLAY = 'autoplay';

// A Spotify track without a usable YouTube match; `reason` is no-match or busy.
class MatchError extends MusicError {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

// The track was skipped or stopped while it was being matched.
class MatchCancelled extends Error {}

function matchFailureReason(error) {
  if (error?.reason === 'no-match') return 'no good YouTube match';
  if (error?.reason === 'busy') return 'too many lookups were running';
  if (error?.code === 'TIMEOUT') return 'the YouTube search timed out';
  return 'YouTube was unreachable';
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

// Music and radio on the shared voice session (src/features/voice/sessions.js), only on its
// musicPlayer. Commands and the control panel live in one text channel per server ("voice").
// Actions that change what plays are announced there publicly; once nothing plays the channel
// is cleaned up so only the panel is left.
function createMusicFeature({
  client,
  env,
  store,
  voiceSessions,
  voice = require('@discordjs/voice'),
  sources = createMusicSources({ ytdlpPath: env.YTDLP_PATH }),
  playlists = createPlaylistStore({ filePath: env.PLAYLISTS_FILE_PATH || null }),
  resumeStore = createResumeStore({ filePath: env.MUSIC_RESUME_FILE_PATH || null }),
  spotify = createSpotifyResolver({ clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET }),
  lookup = dns.promises.lookup,
  // Spotify tracks wait this long between tries while another lookup of the server runs.
  lookupRetryMs = 1_000,
  panelDelayMs = 2_000,
  cleanupDelayMs = 30_000,
  now = Date.now,
  random = Math.random
}) {
  // guildId -> { session, queue, current, paused, loop, child, resource, offset, failed };
  // `paused` is what the user asked for, `offset` where the current track started (seconds).
  const states = new Map();
  const panelTimers = new Map();
  const cleanupTimers = new Map();
  const panelChains = new Map();
  const lookupGuilds = new Set();
  const backgroundGuilds = new Set();
  const cleanupRuns = new Map();
  // guildId -> identities of the last HISTORY_SIZE tracks that started, oldest first (for autoplay),
  // and of autoplay suggestions removed from the queue (never suggested again).
  const histories = new Map();
  const removedSuggestions = new Map();
  // Interactions answered with deferUpdate(); their replies must be follow-ups, not edits of the panel.
  const updateDeferred = new WeakSet();

  voiceSessions.onEnd((session, reason) => {
    const state = states.get(session.guildId);
    if (state?.session === session) {
      saveSnapshot(state, { reason: reason || 'session ended' });
      cancelAutoplay(state);
      stopProcess(state);
      states.delete(session.guildId);
    }
    schedulePanel(session.guildId);
    scheduleCleanup(session.guildId);
  });

  function getMusicConfig(guildId) {
    return store.getGuildConfig(guildId).music;
  }

  function updateMusicConfig(guildId, patch) {
    store.setGuildConfig(guildId, { music: { ...getMusicConfig(guildId), ...patch } });
  }

  function isActive(state) {
    return states.get(state.session.guildId) === state && voiceSessions.get(state.session.guildId) === state.session;
  }

  function activeState(guildId) {
    const session = voiceSessions.get(guildId);
    const state = session ? states.get(guildId) : null;
    return state?.session === session ? state : null;
  }

  function isIdle(guildId) {
    return !activeState(guildId)?.current;
  }

  function getState(session) {
    let state = states.get(session.guildId);
    if (state?.session !== session) {
      // autoplayLookup: the running suggestion lookup; autoplayStopped: gave up for this session.
      state = { session, queue: [], current: null, paused: false, loop: 'off', child: null, resource: null, offset: 0, failed: false, autoplayLookup: null, autoplayStopped: false, autoplayRotation: 0 };
      states.set(session.guildId, state);
      // Only the end of the resource that is playing right now advances the queue; skip/stop clear it first.
      session.musicPlayer.on(voice.AudioPlayerStatus.Idle, (oldState) => {
        if (!isActive(state) || !state.resource || oldState?.resource !== state.resource) return;
        playNext(state);
      });
      // pause() only works while the player is Playing; a pause asked for while the track was still
      // loading or auto-paused for TTS is applied as soon as it plays again.
      session.musicPlayer.on(voice.AudioPlayerStatus.Playing, () => {
        if (isActive(state) && state.paused && state.resource) session.musicPlayer.pause(true);
      });
      session.musicPlayer.on('error', (error) => {
        if (isActive(state) && error?.resource && error.resource === state.resource) state.failed = true;
      });
    }
    return state;
  }

  function stopProcess(state) {
    // The player itself tears down the old audio pipeline; this ends the processes feeding it
    // (and a running Spotify match).
    state.pending = null;
    state.matchAbort?.abort();
    state.matchAbort = null;
    state.child?.kill('SIGKILL');
    state.child = null;
    state.resource = null;
  }

  // Seconds into the current track (0 for radio and live streams).
  function currentPosition(state) {
    if (!state.current || state.current.kind === 'radio' || state.current.isLive) return 0;
    return state.offset + Math.floor((state.resource?.playbackDuration || 0) / 1000);
  }

  // Remembers an interrupted session for /music continue; a finished queue leaves nothing to keep.
  function saveSnapshot(state, { savedBy = null, reason = null } = {}) {
    if (!state.current && !state.queue.length) return;
    resumeStore.set(state.session.guildId, {
      current: state.current,
      position: currentPosition(state),
      queue: state.queue,
      loop: state.loop,
      savedBy,
      reason
    });
  }

  function startItem(state, item, { startAt = 0 } = {}) {
    stopProcess(state);
    const seek = item.kind !== 'radio' && !item.isLive && startAt > 0 ? Math.floor(startAt) : 0;
    const child = item.kind === 'radio'
      ? sources.spawnRadio(item.url)
      : seek ? sources.spawnTrack(item.url, { startAt: seek }) : sources.spawnTrack(item.url);
    const resource = voice.createAudioResource(child.stdout, {
      inputType: voice.StreamType.Raw,
      inlineVolume: true,
      metadata: item
    });
    resource.volume?.setVolume(getMusicConfig(state.session.guildId).volume / 100);

    // Live audio keeps flowing while TTS speaks (and is heard again afterwards); tracks pause and continue.
    state.session.musicPlayer.behaviors.noSubscriber = item.isLive
      ? voice.NoSubscriberBehavior.Play
      : voice.NoSubscriberBehavior.Pause;

    // `paused` is kept: a pause pressed while a Spotify track was matched applies once it plays.
    if (state.current !== item) {
      state.playToken = (state.playToken || 0) + 1;
      rememberPlayed(state.session.guildId, item);
    }
    state.current = item;
    state.pending = null;
    state.child = child;
    state.resource = resource;
    state.offset = seek;
    state.failed = false;
    state.matchFailures = 0;
    cancelCleanup(state.session.guildId);
    state.session.musicPlayer.play(resource);
    schedulePanel(state.session.guildId);
    // The last queued track started: look up the next suggestion now, so there is no gap.
    maybeAutoplay(state);
  }

  // Finds the YouTube match of a Spotify track: one flat yt-dlp search and the best scored result.
  // Weak results are not used (and never saved), the track is skipped instead.
  async function findYouTubeMatch(track, signal = null) {
    const query = spotify.toSearchQuery({ title: track.title, artists: track.artists || [] });
    const candidates = await sources.searchCandidates(query, 5, { signal });
    const durationMs = Number.isFinite(track.duration) ? track.duration * 1000 : track.durationMs || 0;
    const best = spotify.pickBestMatch({ title: track.title, artists: track.artists || [], album: track.album, durationMs }, candidates);
    if (!best) throw new MatchError(`No good YouTube match for **${escapeMarkdown(shorten(displayTitle(track), 100))}**.`, 'no-match');
    return best;
  }

  // Background lookup that waits for a free background slot; stops waiting once `isCancelled()`.
  async function withLookupWhenFree(guildId, task, isCancelled, attempts = 60) {
    for (let attempt = 0; !hasFreeSlot(guildId, true); attempt += 1) {
      if (isCancelled()) throw new MatchCancelled();
      if (attempt >= attempts) throw new MatchError('Too many lookups are running.', 'busy');
      await new Promise((resolve) => setTimeout(resolve, lookupRetryMs));
    }
    if (isCancelled()) throw new MatchCancelled();
    return withLookup(guildId, task, { background: true });
  }

  // Keeps the match on the item and in saved playlists; a failed save must not stop playback.
  function applyMatch(guildId, item, match) {
    item.url = match.url;
    if (!Number.isFinite(item.duration) && Number.isFinite(match.duration)) item.duration = match.duration;
    try {
      playlists.cacheResolvedUrl(guildId, item.spotifyUrl, match.url);
    } catch (error) {
      console.error(`Could not save a Spotify match in guild ${guildId}:`, error.message);
    }
  }

  // Starts a new item; a Spotify track without a YouTube URL is matched first (lazily, right before
  // it plays). The URL is kept on the item, so loops, /music continue and saved playlists reuse it.
  function beginItem(state, item, options = {}) {
    state.paused = false;
    if (item.kind !== 'spotify' || item.url) {
      startItem(state, item, options);
      return;
    }
    stopProcess(state);
    state.session.musicPlayer.stop(true);
    state.playToken = (state.playToken || 0) + 1;
    state.current = item;
    state.offset = 0;
    cancelCleanup(state.session.guildId);
    schedulePanel(state.session.guildId);
    const token = {};
    const abort = new AbortController();
    state.pending = token;
    state.matchAbort = abort;
    void matchAndStart(state, item, options, token, abort.signal);
  }

  async function matchAndStart(state, item, options, token, signal) {
    const { guildId } = state.session;
    // False once the track was skipped or stopped, or the bot left.
    const wanted = () => isActive(state) && state.current === item && state.pending === token;
    let match = null;
    let error = null;
    try {
      match = await withLookupWhenFree(guildId, () => findYouTubeMatch(item, signal), () => !wanted());
    } catch (caught) {
      error = caught;
    }
    if (match) applyMatch(guildId, item, match);
    if (!wanted()) return;
    if (match) {
      startItem(state, item, options);
      return;
    }
    if (!(error instanceof MusicError)) console.error(`Spotify match failed in guild ${guildId}:`, error);
    await skipFailedMatch(state, item, token, error);
  }

  // One note per failed track; after MAX_MATCH_FAILURES in a row the following unmatched Spotify
  // tracks are skipped at once with a single summary.
  async function skipFailedMatch(state, item, token, error) {
    const { guildId } = state.session;
    const reason = matchFailureReason(error);
    state.matchFailures = (state.matchFailures || 0) + 1;
    if (state.matchFailures < MAX_MATCH_FAILURES) {
      await announceIn(guildId, `⚠️ Skipped **${escapeMarkdown(shorten(displayTitle(item), 100))}**: ${reason}.`);
    } else {
      let dropped = 0;
      while (state.queue[0]?.kind === 'spotify' && !state.queue[0].url) {
        state.queue.shift();
        dropped += 1;
      }
      const rest = state.queue.length ? 'Going on with the next playable track.' : 'Nothing playable is left.';
      await announceIn(guildId, `⚠️ Skipped ${plural(dropped + 1, 'Spotify track')} after ${MAX_MATCH_FAILURES} failed matches in a row (${reason}). ${rest}`);
      state.matchFailures = 0;
    }
    if (isActive(state) && state.current === item && state.pending === token) playNext(state, { failed: true });
  }

  // Next item after the current one ended (or was skipped), following the loop mode.
  // `failed` marks an item that could not play at all (it never loops).
  function playNext(state, { skipped = false, failed: failedToStart = false } = {}) {
    const finished = state.current;
    const failed = failedToStart || (!skipped && (state.failed || (state.resource?.playbackDuration || 0) < MIN_LOOP_PLAY_MS));
    const repeatable = (finished?.kind === 'track' || finished?.kind === 'spotify') && !finished.isLive;
    // A track that failed gets one more try in the next loop round; failing again drops it.
    if (repeatable) finished.loopFailures = failed ? (finished.loopFailures || 0) + 1 : 0;
    stopProcess(state);
    state.current = null;
    state.paused = false;
    if (isActive(state) && repeatable && !failed && !skipped && state.loop === 'track') {
      startItem(state, finished);
      return;
    }
    if (repeatable && finished.loopFailures <= 1 && state.loop === 'queue') state.queue.push(finished);
    const next = state.queue.shift();
    if (next && isActive(state)) {
      beginItem(state, next);
      return;
    }
    state.session.musicPlayer.stop(true);
    // Nothing was suggested in time (skip, failed track): a lookup starts the suggestion once found.
    if (repeatable) maybeAutoplay(state, { whenIdle: true });
    schedulePanel(state.session.guildId);
    scheduleCleanup(state.session.guildId);
  }

  function stopAll(state, savedBy = null) {
    saveSnapshot(state, { savedBy, reason: 'stopped' });
    cancelAutoplay(state);
    state.queue = [];
    stopProcess(state);
    state.current = null;
    state.paused = false;
    state.session.musicPlayer.stop(true);
    schedulePanel(state.session.guildId);
    scheduleCleanup(state.session.guildId);
  }

  // --- autoplay ------------------------------------------------------------------------------

  function isAutoplayItem(item) {
    return item?.addedBy === AUTOPLAY;
  }

  // Tracks with a YouTube video (Spotify items by their match); radio and live streams are left out.
  function rememberPlayed(guildId, item) {
    if (item.kind === 'radio' || item.isLive || !item.url) return;
    const identity = trackIdentity(item);
    if (!identity.videoId) return;
    const history = histories.get(guildId) || [];
    history.push({ ...identity, auto: isAutoplayItem(item) });
    histories.set(guildId, history.slice(-HISTORY_SIZE));
  }

  function rememberRemoved(guildId, item) {
    const removed = removedSuggestions.get(guildId) || [];
    removed.push(trackIdentity(item));
    removedSuggestions.set(guildId, removed.slice(-HISTORY_SIZE));
  }

  // Seeds, newest first: the last SEED_COUNT tracks members picked; autoplay picks only fill up
  // missing seeds, so the suggestions don't drift away from what people asked for.
  function autoplaySeeds(guildId) {
    const history = [...(histories.get(guildId) || [])].reverse();
    const seeds = [];
    for (const entry of [...history.filter((item) => !item.auto), ...history.filter((item) => item.auto)]) {
      if (seeds.length >= SEED_COUNT) break;
      if (!seeds.some((seed) => seed.videoId === entry.videoId)) seeds.push(entry);
    }
    return seeds;
  }

  function autoplayEnabled(state) {
    return isActive(state) && getMusicConfig(state.session.guildId).autoplay === true
      && !state.autoplayStopped && state.loop === 'off';
  }

  function autoplayNote(state) {
    if (!state) return null;
    if (state.autoplayStopped) return 'stopped for this session';
    if (state.loop !== 'off') return 'waits until loop is off';
    return null;
  }

  // Stop, skip, radio, loop and leaving cancel a running lookup (and kill its yt-dlp).
  function cancelAutoplay(state) {
    state.autoplayLookup?.abort.abort();
    state.autoplayLookup = null;
  }

  // Keeps one suggestion ahead: starts a lookup when the queue is empty behind a playing track
  // (or, with `whenIdle`, after the queue ran out). Radio and live streams never trigger it.
  function maybeAutoplay(state, { whenIdle = false } = {}) {
    if (!autoplayEnabled(state) || state.autoplayLookup || state.queue.length) return;
    const { current } = state;
    if (current ? current.kind === 'radio' || current.isLive : !whenIdle) return;
    if (!autoplaySeeds(state.session.guildId).length) return;
    const lookup = { abort: new AbortController() };
    state.autoplayLookup = lookup;
    void runAutoplay(state, lookup).catch((error) => {
      console.error(`Autoplay failed in guild ${state.session.guildId}:`, error);
      if (state.autoplayLookup === lookup) state.autoplayLookup = null;
    });
  }

  function autoplayItem(entry) {
    return {
      kind: 'track',
      title: entry.title.slice(0, 200) || 'Unknown title',
      url: entry.url,
      source: 'YouTube',
      author: entry.uploader || null,
      duration: entry.duration,
      isLive: false,
      thumbnail: null,
      requesterId: null,
      addedBy: AUTOPLAY
    };
  }

  // The best entry of the seed's YouTube Music radio, else of its YouTube Mix; null if none fits.
  async function findSuggestion(state, seed, signal) {
    const { guildId } = state.session;
    const history = histories.get(guildId) || [];
    const queued = state.queue.map((item) => trackIdentity(item));
    const known = [...history, ...queued, ...(removedSuggestions.get(guildId) || [])];
    const context = {
      seed,
      recent: [...history, ...queued],
      playedIds: new Set(known.map((entry) => entry.videoId).filter(Boolean)),
      playedKeys: new Set(known.map((entry) => entry.key))
    };
    let lastError = null;
    for (const source of ['music', 'youtube']) {
      try {
        const pick = pickSuggestion(await sources.fetchMix(seed.videoId, { source, signal }), context);
        if (pick) return pick;
        lastError = null;
      } catch (error) {
        if (error?.code === 'ABORTED') throw error;
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  // Tries the seeds in turn (rotating between suggestions); if none gives a usable song, autoplay
  // stops for this session with one public note.
  async function runAutoplay(state, lookup) {
    const { guildId } = state.session;
    const wanted = () => isActive(state) && state.autoplayLookup === lookup;
    const seeds = autoplaySeeds(guildId);
    const start = state.autoplayRotation % seeds.length;
    let suggestion = null;
    let lastError = null;
    // A seed whose mixes had nothing usable is not tried again; one that failed (timeout,
    // YouTube unreachable) may be, so a single seed still gets its three attempts.
    const exhausted = new Set();
    for (let attempt = 0; attempt < MAX_AUTOPLAY_ATTEMPTS && !suggestion && exhausted.size < seeds.length; attempt += 1) {
      let index = (start + attempt) % seeds.length;
      while (exhausted.has(index)) index = (index + 1) % seeds.length;
      const seed = seeds[index];
      try {
        suggestion = await withLookupWhenFree(guildId, () => findSuggestion(state, seed, lookup.abort.signal), () => !wanted());
        if (!suggestion) {
          exhausted.add(index);
          lastError = null;
        }
      } catch (error) {
        if (error instanceof MatchCancelled || error?.code === 'ABORTED' || !wanted()) return;
        if (!(error instanceof MusicError)) console.error(`Autoplay lookup failed in guild ${guildId}:`, error);
        lastError = error;
      }
      if (!wanted()) return;
    }
    state.autoplayLookup = null;
    if (!suggestion) {
      state.autoplayStopped = true;
      schedulePanel(guildId);
      const reason = lastError ? matchFailureReason(lastError) : 'no fitting songs were found';
      await announceIn(guildId, `⚠️ Autoplay stopped for this session: ${reason}. \`/music autoplay\` turns it on again.`);
      return;
    }
    state.autoplayRotation = start + 1;
    // Loop or autoplay switched meanwhile, or a suggestion is already queued: stay at one ahead.
    if (!autoplayEnabled(state) || state.queue.some(isAutoplayItem)) return;
    const item = autoplayItem(suggestion);
    if (state.current) {
      state.queue.push(item);
      schedulePanel(guildId);
    } else {
      beginItem(state, item);
    }
    await announceIn(guildId, `🔁 Autoplay: ${titleOf(item)} (${describeLength(item)})`);
  }

  // Member picks go before the autoplay suggestions at the end of the queue; returns their index.
  function insertUserItems(state, items) {
    let index = state.queue.length;
    while (index > 0 && isAutoplayItem(state.queue[index - 1])) index -= 1;
    state.queue.splice(index, 0, ...items);
    return index;
  }

  function withSuggestionsLast(queue) {
    return [...queue.filter((item) => !isAutoplayItem(item)), ...queue.filter(isAutoplayItem)];
  }

  // --- control panel -------------------------------------------------------------------------

  function resumableCount(guildId) {
    const snapshot = resumeStore.get(guildId);
    return snapshot ? (snapshot.current ? 1 : 0) + snapshot.queue.length : 0;
  }

  function getPanelState(guildId) {
    const session = voiceSessions.get(guildId);
    const state = activeState(guildId);
    const config = getMusicConfig(guildId);
    const current = state?.current || null;
    return {
      current,
      queue: state?.queue || [],
      paused: Boolean(state?.paused),
      loop: state?.loop || 'off',
      autoplay: config.autoplay === true,
      autoplayNote: autoplayNote(state),
      playToken: state?.playToken || 0,
      volume: config.volume,
      channelId: session?.channelId || null,
      stations: listStations(config.stations),
      playlists: playlists.listPublic(guildId).slice(0, 25),
      resumable: current ? 0 : resumableCount(guildId)
    };
  }

  // null when the channel is gone; other errors (network, rate limits) are thrown.
  async function fetchChannel(guild, channelId) {
    if (!channelId) return null;
    const cached = guild.channels.cache.get(channelId);
    if (cached) return cached;
    try {
      return await guild.channels.fetch(channelId);
    } catch (error) {
      if (error?.code === UNKNOWN_CHANNEL || error?.status === 404) return null;
      throw error;
    }
  }

  async function writePanel(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const config = getMusicConfig(guildId);
    const channel = await fetchChannel(guild, config.controlChannelId);
    if (!channel?.messages) return;

    const payload = buildPanelMessage(getPanelState(guildId));
    if (config.panelMessageId) {
      let message = null;
      try {
        message = await channel.messages.fetch(config.panelMessageId);
      } catch (error) {
        // Only a deleted panel is posted again; on other errors the old one stays to avoid duplicates.
        if (error?.code !== UNKNOWN_MESSAGE) {
          console.error(`Could not load the music panel in guild ${guildId}:`, error.message);
          return;
        }
      }
      if (message) {
        await message.edit(payload);
        return;
      }
    }
    const posted = await channel.send(payload);
    // /setup may have moved the control channel while this was sent; then this message is stale.
    if (getMusicConfig(guildId).controlChannelId !== channel.id) {
      await posted.delete?.().catch(() => {});
      schedulePanel(guildId);
      return;
    }
    updateMusicConfig(guildId, { panelMessageId: posted.id });
  }

  // Panel writes per guild run one after another so a deleted panel is only re-posted once.
  function enqueue(guildId, task, label) {
    const previous = panelChains.get(guildId) || Promise.resolve();
    const next = previous
      .then(task)
      .catch((error) => console.error(`${label} failed in guild ${guildId}:`, error.message));
    panelChains.set(guildId, next);
    return next;
  }

  function refreshPanel(guildId) {
    return enqueue(guildId, () => writePanel(guildId), 'Music panel update');
  }

  function schedulePanel(guildId) {
    if (panelTimers.has(guildId)) return;
    const timer = setTimeout(() => {
      panelTimers.delete(guildId);
      void refreshPanel(guildId);
    }, panelDelayMs);
    timer.unref?.();
    panelTimers.set(guildId, timer);
  }

  // --- channel cleanup -----------------------------------------------------------------------

  async function fetchRecentMessages(channel) {
    const messages = [];
    let before = null;
    for (let page = 0; page < CLEANUP_MAX_PAGES; page += 1) {
      const batch = [...(await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })).values()];
      messages.push(...batch);
      if (batch.length < 100) break;
      before = batch.reduce((oldest, message) => (message.createdTimestamp < oldest.createdTimestamp ? message : oldest)).id;
    }
    return messages;
  }

  function canManageMessages(guild, channel) {
    const me = guild.members?.me;
    const permissions = me ? channel.permissionsFor?.(me) : null;
    return permissions?.has?.(PermissionsBitField.Flags.ManageMessages) === true;
  }

  async function deleteOne(message) {
    return message.delete().then(() => true, () => false);
  }

  // While nothing plays: in the bot's own channel (and with Manage Messages) every message except
  // the panel and pinned ones is deleted; in a channel an admin picked only the bot's own messages
  // are. Stops as soon as playback starts again; failures are ignored. If messages before and after
  // the panel survive in the bot's channel, the panel is posted again so it is the newest message.
  async function cleanChannel(guildId) {
    if (!isIdle(guildId)) return;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild ? await fetchChannel(guild, getMusicConfig(guildId).controlChannelId) : null;
    if (!channel?.messages?.fetch) return;

    const canManage = canManageMessages(guild, channel);
    const everything = canManage && isManagedChannel(channel);
    const messages = await fetchRecentMessages(channel);
    if (!isIdle(guildId)) return;
    const { panelMessageId } = getMusicConfig(guildId);
    const panel = messages.find((message) => message.id === panelMessageId) || null;
    const others = messages.filter((message) => message.id !== panelMessageId);
    const targets = others.filter((message) => !message.pinned && (everything || message.author?.id === client.user?.id));
    const cutoff = now() - BULK_DELETE_MAX_AGE_MS;
    // Bulk delete needs Manage Messages; without it own messages go one by one (capped below).
    const bulk = canManage ? targets.filter((message) => message.createdTimestamp > cutoff) : [];
    const single = targets.filter((message) => !bulk.includes(message)).slice(0, MAX_SINGLE_DELETES);
    const deleted = new Set();

    for (let index = 0; index < bulk.length && isIdle(guildId); index += 100) {
      const chunk = bulk.slice(index, index + 100);
      if (chunk.length === 1 || !channel.bulkDelete) {
        for (const message of chunk) if (await deleteOne(message)) deleted.add(message.id);
        continue;
      }
      try {
        const result = await channel.bulkDelete(chunk.map((message) => message.id));
        for (const id of result?.keys?.() || []) deleted.add(id);
      } catch {
        // Already deleted or missing permissions: leave them.
      }
    }
    for (const message of single) {
      if (!isIdle(guildId)) return;
      if (await deleteOne(message)) deleted.add(message.id);
    }
    if (!isIdle(guildId)) return;

    if (!panel) {
      await refreshPanel(guildId);
      return;
    }
    const remaining = others.filter((message) => !deleted.has(message.id));
    const olderLeft = remaining.some((message) => message.createdTimestamp < panel.createdTimestamp);
    const newerLeft = remaining.some((message) => message.createdTimestamp > panel.createdTimestamp);
    if (everything && olderLeft && newerLeft) {
      updateMusicConfig(guildId, { panelMessageId: null });
      await panel.delete().catch(() => {});
      await refreshPanel(guildId);
    }
  }

  // One cleanup per guild at a time, outside the panel queue so it never delays panel updates.
  function runCleanup(guildId) {
    if (cleanupRuns.has(guildId)) return cleanupRuns.get(guildId);
    const run = cleanChannel(guildId)
      .catch((error) => console.error(`Music channel cleanup failed in guild ${guildId}:`, error.message))
      .finally(() => cleanupRuns.delete(guildId));
    cleanupRuns.set(guildId, run);
    return run;
  }

  function cancelCleanup(guildId) {
    clearTimeout(cleanupTimers.get(guildId));
    cleanupTimers.delete(guildId);
  }

  // Debounced: every new idle event or message restarts the wait; new playback cancels it.
  function scheduleCleanup(guildId) {
    cancelCleanup(guildId);
    const timer = setTimeout(() => {
      cleanupTimers.delete(guildId);
      if (isIdle(guildId)) void runCleanup(guildId);
    }, cleanupDelayMs);
    timer.unref?.();
    cleanupTimers.set(guildId, timer);
  }

  async function refreshAndClean(guildId) {
    await refreshPanel(guildId);
    if (isIdle(guildId)) await runCleanup(guildId);
  }

  // --- control channel and role setup --------------------------------------------------------

  // Creates or finds the Voice role once; afterwards a role an admin cleared or deleted stays gone.
  async function ensureVoiceRole(guild) {
    const config = getMusicConfig(guild.id);
    let role = config.roleId
      ? guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null)
      : null;
    if (!role && config.roleSetupDone) return null;

    if (!role) {
      role = guild.roles.cache.find((entry) => normalizeName(entry.name) === normalizeName(env.MUSIC_ROLE_NAME)) || null;
    }
    if (!role) {
      try {
        role = await guild.roles.create({
          name: env.MUSIC_ROLE_NAME,
          permissions: [],
          mentionable: false,
          reason: 'Members with this role see the music channel.'
        });
        console.log(`Created Voice role ${role.id} in guild ${guild.id} (${guild.name})`);
      } catch (error) {
        console.error(`Could not create the Voice role in guild ${guild.id} (${guild.name}); the bot needs Manage Roles:`, error.message);
        return null;
      }
    }

    updateMusicConfig(guild.id, { roleId: role.id, roleSetupDone: true });
    return role;
  }

  function controlChannelOverwrites(guild, roleId) {
    return [
      { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
      ...(roleId ? [{ id: roleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseApplicationCommands'] }] : []),
      { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageMessages'] }
    ];
  }

  // Only the bot's own "voice" channel is ever hidden; a channel an admin picked keeps its permissions.
  function isManagedChannel(channel) {
    return normalizeName(channel?.name) === normalizeName(env.MUSIC_CHANNEL_NAME);
  }

  async function applyChannelAccess(guild, channel, previousRoleId = null) {
    if (!isManagedChannel(channel) || !channel.permissionOverwrites) return;
    const { roleId } = getMusicConfig(guild.id);
    try {
      for (const overwrite of controlChannelOverwrites(guild, roleId)) {
        const options = Object.fromEntries([
          ...(overwrite.allow || []).map((name) => [name, true]),
          ...(overwrite.deny || []).map((name) => [name, false])
        ]);
        await channel.permissionOverwrites.edit(overwrite.id, options, { reason: 'Music channel is only for the Voice role.' });
      }
      if (previousRoleId && previousRoleId !== roleId) {
        await channel.permissionOverwrites.delete(previousRoleId, 'Voice role changed.').catch(() => {});
      }
      updateMusicConfig(guild.id, { accessSetupDone: true });
    } catch (error) {
      console.error(`Could not limit the music channel to the Voice role in guild ${guild.id} (${guild.name}); the bot needs Manage Channels/Roles:`, error.message);
    }
  }

  // Uses the stored channel; otherwise sets one up once per server (one named MUSIC_CHANNEL_NAME,
  // else a new one) and then posts the panel. After that first setup a channel that admins cleared
  // or deleted stays unset, and /music says so. While nothing plays the channel is cleaned up.
  async function ensureControlChannel(guild) {
    const role = await ensureVoiceRole(guild);
    const config = getMusicConfig(guild.id);
    let channel;
    try {
      channel = await fetchChannel(guild, config.controlChannelId);
    } catch (error) {
      console.error(`Could not load the music channel in guild ${guild.id} (${guild.name}):`, error.message);
      return null;
    }
    if (channel) {
      if (!getMusicConfig(guild.id).autoSetupDone) updateMusicConfig(guild.id, { autoSetupDone: true });
      if (!getMusicConfig(guild.id).accessSetupDone) await applyChannelAccess(guild, channel);
      await refreshAndClean(guild.id);
      return channel;
    }
    if (config.autoSetupDone) return null;

    channel = guild.channels.cache.find((entry) => entry.type === ChannelType.GuildText
      && normalizeName(entry.name) === normalizeName(env.MUSIC_CHANNEL_NAME)) || null;
    if (!channel) {
      try {
        channel = await guild.channels.create({
          name: env.MUSIC_CHANNEL_NAME,
          type: ChannelType.GuildText,
          topic: 'Music and radio: use /music and /playlist here. The panel shows what is playing.',
          permissionOverwrites: controlChannelOverwrites(guild, role?.id || null),
          reason: 'Control channel for the music and radio player (/music).'
        });
        console.log(`Created music channel ${channel.id} in guild ${guild.id} (${guild.name})`);
      } catch (error) {
        console.error(`Could not create the music channel in guild ${guild.id} (${guild.name}); the bot needs Manage Channels:`, error.message);
        return null;
      }
    }

    // Re-read: an admin may have picked a channel in /setup in the meantime.
    const latest = getMusicConfig(guild.id);
    if (latest.controlChannelId && latest.controlChannelId !== config.controlChannelId) {
      updateMusicConfig(guild.id, { autoSetupDone: true });
      await refreshAndClean(guild.id);
      return fetchChannel(guild, latest.controlChannelId).catch(() => null);
    }
    updateMusicConfig(guild.id, {
      autoSetupDone: true,
      ...(channel.id !== latest.controlChannelId ? { controlChannelId: channel.id, panelMessageId: null } : {})
    });
    if (!getMusicConfig(guild.id).accessSetupDone) await applyChannelAccess(guild, channel);
    await refreshAndClean(guild.id);
    return channel;
  }

  async function handleMessageDelete(message) {
    if (!message.guildId) return;
    const config = getMusicConfig(message.guildId);
    if (config.panelMessageId && message.id === config.panelMessageId) {
      updateMusicConfig(message.guildId, { panelMessageId: null });
      schedulePanel(message.guildId);
    }
  }

  // A message in the control channel while nothing plays is cleaned up after the idle delay.
  async function handleMessageCreate(message) {
    if (!message.guildId) return;
    const config = getMusicConfig(message.guildId);
    if (!config.controlChannelId || message.channelId !== config.controlChannelId || message.id === config.panelMessageId) return;
    if (isIdle(message.guildId)) scheduleCleanup(message.guildId);
  }

  // --- actions shared by commands and panel --------------------------------------------------

  function isManager(member) {
    return env.PRIVILEGED_USER_IDS.has(String(member.id))
      || member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) === true;
  }

  function actorOf(ctx) {
    return { id: String(ctx.member.id), isManager: isManager(ctx.member) };
  }

  function who(ctx) {
    return `**${escapeMarkdown(shorten(ctx.member.displayName || ctx.member.user?.username || 'Someone', 64))}**`;
  }

  function titleOf(item) {
    return `**${escapeMarkdown(shorten(displayTitle(item), 100))}**`;
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  // Playback controls need a listener of the bot's channel; managers may always use them.
  function requireControl(ctx) {
    const session = voiceSessions.get(ctx.guild.id);
    const state = session ? states.get(ctx.guild.id) : null;
    if (!session || state?.session !== session || !state.current) throw new MusicError('Nothing is playing right now.');
    if (ctx.member.voice?.channelId !== session.channelId && !isManager(ctx.member)) {
      throw new MusicError(`Join <#${session.channelId}> to control the music.`);
    }
    return state;
  }

  // Checks before slow work (yt-dlp) that the member can bring the bot or is with it.
  function checkVoiceChannel(ctx) {
    const channel = ctx.member.voice?.channel;
    if (!channel) throw new MusicError('Join a voice channel first.');
    const session = voiceSessions.get(ctx.guild.id);
    if (session && session.channelId !== channel.id) throw new MusicError(`I'm already playing in <#${session.channelId}>.`);
    return channel;
  }

  async function ensureSession(ctx) {
    const channel = checkVoiceChannel(ctx);
    try {
      const { session } = await voiceSessions.join({
        guild: ctx.guild,
        channel,
        ownerId: ctx.member.id,
        notifyChannelId: getMusicConfig(ctx.guild.id).controlChannelId
      });
      return session;
    } catch (error) {
      throw new MusicError(error.message);
    }
  }

  function hasFreeSlot(guildId, background = false) {
    const [slots, max] = background ? [backgroundGuilds, MAX_BACKGROUND_LOOKUPS] : [lookupGuilds, MAX_LOOKUPS];
    return !slots.has(guildId) && slots.size < max;
  }

  // Runs one yt-dlp lookup with the per-server and global limits (commands and background
  // Spotify matches have separate slots).
  async function withLookup(guildId, task, { background = false } = {}) {
    if (!hasFreeSlot(guildId, background)) {
      throw new MusicError('⏳ I am busy looking up another track. Try again in a moment.');
    }
    const slots = background ? backgroundGuilds : lookupGuilds;
    slots.add(guildId);
    try {
      return await task();
    } finally {
      slots.delete(guildId);
    }
  }

  function lookupTrack(guildId, query) {
    return withLookup(guildId, () => sources.resolveTrack(query));
  }

  // Spotify metadata as a queue item; `url` (the YouTube match) stays null until it plays.
  function spotifyItem(track, requesterId = null) {
    return {
      kind: 'spotify',
      source: 'spotify',
      title: String(track.title || 'Unknown title').slice(0, 200),
      artists: track.artists || [],
      ...(track.album && { album: track.album }),
      duration: track.durationMs ? Math.round(track.durationMs / 1000) : (Number.isFinite(track.duration) ? track.duration : null),
      isLive: false,
      spotifyUrl: track.spotifyUrl,
      url: track.url || null,
      author: null,
      thumbnail: null,
      requesterId
    };
  }

  // A saved playlist track as a queue item.
  function storedItem(track, requesterId) {
    if (track.source === 'spotify') return { ...spotifyItem(track, requesterId), url: track.url || null };
    return { kind: 'track', ...track, source: 'YouTube', author: null, thumbnail: null, requesterId };
  }

  // New playback after a stopped session replaces its snapshot (Continue then offers nothing old).
  function startFresh(state) {
    if (!state.current) resumeStore.clear(state.session.guildId);
  }

  // Starts the first item when nothing (or only radio) plays and queues the rest up to `limit`.
  function enqueueItems(state, items, { next = false, limit = MAX_PLAYLIST_QUEUE } = {}) {
    startFresh(state);
    const rest = [...items];
    const first = !state.current || state.current.kind === 'radio' ? rest.shift() : null;
    const room = Math.max(0, limit - state.queue.length);
    if (!first && !room) throw new MusicError(`The queue is full (${limit} tracks).`);
    const queued = rest.slice(0, room);
    if (next) state.queue.unshift(...queued);
    else insertUserItems(state, queued);
    if (first) beginItem(state, first);
    else schedulePanel(state.session.guildId);
    return { count: queued.length + (first ? 1 : 0), dropped: rest.length - queued.length };
  }

  function limitNote(dropped) {
    return dropped ? ` — the queue is limited to ${MAX_PLAYLIST_QUEUE} tracks, ${dropped} not queued` : '';
  }

  // Spotify links: a track is matched on YouTube right away; albums, playlists and artists are
  // queued as Spotify items that are matched one by one when they play.
  async function playSpotify(ctx, link, { next = false } = {}) {
    checkVoiceChannel(ctx);
    const { resolved, item } = await withLookup(ctx.guild.id, async () => {
      const result = await spotify.resolve(link, { limit: MAX_PLAYLIST_QUEUE });
      if (result.kind !== 'track') return { resolved: result };
      const single = spotifyItem(result.tracks[0], ctx.member.id);
      const match = await findYouTubeMatch(single);
      single.url = match.url;
      if (!Number.isFinite(single.duration)) single.duration = match.duration;
      return { resolved: result, item: single };
    });
    const state = getState(await ensureSession(ctx));
    if (item) return queueSingle(ctx, state, item, { next });

    const { count, dropped } = enqueueItems(state, resolved.tracks.map((track) => spotifyItem(track, ctx.member.id)), { next });
    const cut = resolved.truncated ? ' (Spotify only lists the first 100)' : '';
    return { announce: `📃 ${who(ctx)} queued Spotify ${resolved.kind} **${escapeMarkdown(shorten(resolved.name, 100))}** (${plural(count, 'track')})${cut}${limitNote(dropped)}` };
  }

  async function play(ctx, query, { next = false } = {}) {
    if (isSpotifyLink(query)) return playSpotify(ctx, query, { next });
    checkVoiceChannel(ctx);
    const track = await lookupTrack(ctx.guild.id, query);
    const state = getState(await ensureSession(ctx));
    return queueSingle(ctx, state, { ...track, requesterId: ctx.member.id }, { next });
  }

  function queueSingle(ctx, state, item, { next = false } = {}) {
    const label = `${titleOf(item)} (${describeLength(item)})`;
    if (!state.current || state.current.kind === 'radio') {
      const replacedRadio = state.current?.kind === 'radio';
      startFresh(state);
      beginItem(state, item);
      return { announce: `▶️ ${who(ctx)} started ${label}${replacedRadio ? ' and stopped the radio' : ''}` };
    }
    if (state.queue.length >= MAX_QUEUE) throw new MusicError(`The queue is full (${MAX_QUEUE} tracks).`);
    let position = 1;
    if (next) state.queue.unshift(item);
    else position = insertUserItems(state, [item]) + 1;
    schedulePanel(ctx.guild.id);
    return { announce: next ? `⏫ ${who(ctx)} added ${label} — up next` : `🎵 ${who(ctx)} added ${label} — position ${position}` };
  }

  // Resolves a radio station and checks custom URLs again (with DNS) at play time.
  async function stationUrl(station) {
    if (!station.custom) return station.url;
    try {
      return await assertPublicStationUrl(station.url, { lookup });
    } catch (error) {
      throw new MusicError(`Can't play **${station.name}**: ${error.message}`);
    }
  }

  function radioItem(station, url, requesterId) {
    return { kind: 'radio', title: station.name, url, stationKey: station.key, source: 'Radio', isLive: true, duration: null, requesterId };
  }

  async function playRadio(ctx, stationKey) {
    const station = findStation(stationKey, getMusicConfig(ctx.guild.id).stations);
    if (!station) throw new MusicError('Unknown station. Pick one from the list.');
    checkVoiceChannel(ctx);
    const url = await stationUrl(station);
    const state = getState(await ensureSession(ctx));
    const dropped = state.queue.length;
    state.queue = [];
    cancelAutoplay(state);
    startFresh(state);
    beginItem(state, radioItem(station, url, ctx.member.id));
    return { announce: `📻 ${who(ctx)} switched to **${escapeMarkdown(station.name)}**${dropped ? ` and cleared ${plural(dropped, 'queued track')}` : ''}` };
  }

  // Rejoins and restores the last interrupted session; tracks continue where they were.
  async function continueSession(ctx) {
    if (!isIdle(ctx.guild.id)) throw new MusicError('Something is already playing. Stop it first to continue the last session.');
    const snapshot = resumeStore.get(ctx.guild.id);
    if (!snapshot) throw new MusicError('There is no stopped session to continue (they are kept for 24 hours).');
    checkVoiceChannel(ctx);

    let first = snapshot.current;
    let startAt = snapshot.position;
    if (first?.kind === 'radio') {
      const station = findStation(first.stationKey || first.title, getMusicConfig(ctx.guild.id).stations);
      first = station ? radioItem(station, await stationUrl(station), first.requesterId) : null;
      startAt = 0;
    }
    const state = getState(await ensureSession(ctx));
    if (!isIdle(ctx.guild.id)) throw new MusicError('Something is already playing. Stop it first to continue the last session.');
    state.queue = snapshot.queue.slice(0, MAX_PLAYLIST_QUEUE).map((item) => ({ ...item }));
    state.loop = snapshot.loop;
    if (!first) {
      first = state.queue.shift();
      startAt = 0;
    }
    if (!first) throw new MusicError('There is nothing left to continue.');
    beginItem(state, { ...first }, { startAt });
    // Used up; if this session is interrupted again, that saves a new snapshot.
    resumeStore.clear(ctx.guild.id);
    const count = 1 + state.queue.length;
    const at = startAt > 0 ? ` at ${formatDuration(startAt)}` : '';
    return { announce: `⏯️ ${who(ctx)} continued the last session (${plural(count, 'track')}) with ${titleOf(first)}${at}` };
  }

  // `token` (from the panel button) must still be the current track's, so a double press skips once.
  function skip(ctx, token = null) {
    const state = requireControl(ctx);
    if (token !== null && token !== String(state.playToken || 0)) return 'That track already changed.';
    const skipped = state.current;
    cancelAutoplay(state);
    playNext(state, { skipped: true });
    return { announce: `⏭️ ${who(ctx)} skipped ${titleOf(skipped)}${state.current ? ` · now playing ${titleOf(state.current)}` : ''}` };
  }

  function stop(ctx) {
    stopAll(requireControl(ctx), ctx.member.id);
    return { announce: `⏹️ ${who(ctx)} stopped playback and cleared the queue. \`/music continue\` picks it up again.` };
  }

  // `paused` is the user's wish; when the player can't pause right now (loading, auto-paused while
  // TTS speaks) the Playing listener in getState applies it later.
  function pause(ctx) {
    const state = requireControl(ctx);
    if (state.paused) return '⏸️ Already paused.';
    state.paused = true;
    state.session.musicPlayer.pause(true);
    schedulePanel(ctx.guild.id);
    return '⏸️ Paused.';
  }

  function resume(ctx) {
    const state = requireControl(ctx);
    if (!state.paused) return '▶️ Already playing.';
    state.paused = false;
    // false while auto-paused for TTS or loading; the player then continues on its own.
    state.session.musicPlayer.unpause();
    schedulePanel(ctx.guild.id);
    return '▶️ Resumed.';
  }

  function shuffleQueue(ctx) {
    const state = requireControl(ctx);
    if (state.queue.length < 2) throw new MusicError('There is nothing to shuffle; queue at least two tracks.');
    state.queue = withSuggestionsLast(shuffled(state.queue, random));
    schedulePanel(ctx.guild.id);
    return { announce: `🔀 ${who(ctx)} shuffled the queue (${plural(state.queue.length, 'track')})` };
  }

  function clearQueue(ctx) {
    const state = requireControl(ctx);
    const count = state.queue.length;
    if (!count) throw new MusicError('The queue is already empty.');
    state.queue = [];
    schedulePanel(ctx.guild.id);
    maybeAutoplay(state);
    return { announce: `🧹 ${who(ctx)} cleared the queue (${plural(count, 'track')})` };
  }

  function removeFromQueue(ctx, position) {
    const state = requireControl(ctx);
    const { queue, removed } = removeAt(state.queue, position);
    state.queue = queue;
    schedulePanel(ctx.guild.id);
    // A removed suggestion is not suggested again; the next one is looked up right away.
    if (isAutoplayItem(removed)) rememberRemoved(ctx.guild.id, removed);
    maybeAutoplay(state);
    return `🗑️ Removed ${describeItem(removed)} from position ${position}.`;
  }

  function moveInQueue(ctx, from, to) {
    const state = requireControl(ctx);
    const { queue, moved } = moveItem(state.queue, from, to);
    state.queue = queue;
    schedulePanel(ctx.guild.id);
    return `↕️ Moved ${describeItem(moved)} to position ${to}.`;
  }

  function setLoop(ctx, mode = null) {
    const state = requireControl(ctx);
    const next = LOOP_MODES.includes(mode) ? mode : nextLoopMode(state.loop);
    state.loop = next;
    // Loops replay the queue, so autoplay waits until looping is off again.
    if (next === 'off') maybeAutoplay(state);
    else cancelAutoplay(state);
    schedulePanel(ctx.guild.id);
    const text = { off: 'turned looping **off**', track: 'set loop to **this track**', queue: 'set loop to **the whole queue**' }[next];
    return { announce: `${next === 'track' ? '🔂' : '🔁'} ${who(ctx)} ${text}` };
  }

  // `mode` on/off, or null to toggle; saved per server. Same rules as loop and shuffle.
  function setAutoplay(ctx, mode = null) {
    const state = requireControl(ctx);
    const enabled = mode === 'on' ? true : mode === 'off' ? false : getMusicConfig(ctx.guild.id).autoplay !== true;
    updateMusicConfig(ctx.guild.id, { autoplay: enabled });
    let note = '';
    if (enabled) {
      state.autoplayStopped = false;
      maybeAutoplay(state);
      if (state.loop !== 'off') note = ' (it waits until looping is off)';
    } else {
      cancelAutoplay(state);
      const dropped = state.queue.filter(isAutoplayItem).length;
      state.queue = state.queue.filter((item) => !isAutoplayItem(item));
      if (dropped) note = ` and removed ${plural(dropped, 'suggestion')} from the queue`;
    }
    schedulePanel(ctx.guild.id);
    return { announce: `♾️ ${who(ctx)} turned autoplay **${enabled ? 'on' : 'off'}**${note}` };
  }

  function setVolume(ctx, level) {
    const session = voiceSessions.get(ctx.guild.id);
    if (!session && !isManager(ctx.member)) {
      throw new MusicError('Only server managers can change the volume while I am not in a voice channel.');
    }
    if (session && ctx.member.voice?.channelId !== session.channelId && !isManager(ctx.member)) {
      throw new MusicError(`Join <#${session.channelId}> to change the volume.`);
    }
    const volume = Math.min(100, Math.max(0, Math.round(level)));
    updateMusicConfig(ctx.guild.id, { volume });
    const state = session ? states.get(ctx.guild.id) : null;
    state?.resource?.volume?.setVolume(volume / 100);
    schedulePanel(ctx.guild.id);
    return `🔊 Volume set to ${volume}%.`;
  }

  function showQueue(ctx, page = 0) {
    const panelState = getPanelState(ctx.guild.id);
    if (!panelState.current) return 'Nothing is playing right now.';
    return { view: buildQueueView(panelState, page) };
  }

  function nowPlaying(ctx) {
    const { current, paused } = getPanelState(ctx.guild.id);
    if (!current) return 'Nothing is playing right now.';
    const elapsed = currentPosition(states.get(ctx.guild.id));
    const position = current.isLive ? '🔴 Live' : `${formatDuration(elapsed)} / ${formatDuration(current.duration)}`;
    return [
      `${paused ? '⏸️' : '▶️'} ${describeItem(current)}`,
      `${current.kind === 'radio' ? 'Radio station' : describeSource(current)} · ${position}`,
      `Requested by ${describeRequester(current)}`
    ].join('\n');
  }

  // --- playlists -----------------------------------------------------------------------------

  // Public playlists are announced; changes to private ones are only told to their owner.
  function playlistResult(playlist, text, reply) {
    return playlist.visibility === 'public' ? { announce: text } : reply;
  }

  async function playPlaylist(ctx, playlist, { shuffle = false } = {}) {
    if (!playlist.tracks.length) throw new MusicError(`**${escapeMarkdown(playlist.name)}** is empty.`);
    checkVoiceChannel(ctx);
    const state = getState(await ensureSession(ctx));
    const items = (shuffle ? shuffled(playlist.tracks, random) : playlist.tracks).map((track) => storedItem(track, ctx.member.id));
    const { count, dropped } = enqueueItems(state, items);
    playlists.markUsed(ctx.guild.id, playlist.id);
    schedulePanel(ctx.guild.id);

    const details = `(${plural(count, 'track')}${shuffle ? ', shuffled' : ''})${limitNote(dropped)}`;
    if (playlist.visibility !== 'public') return { announce: `📃 ${who(ctx)} queued a private playlist ${details}` };
    const by = playlist.ownerId !== String(ctx.member.id) ? ` by <@${playlist.ownerId}>` : '';
    return { announce: `📃 ${who(ctx)} queued playlist **${escapeMarkdown(playlist.name)}**${by} ${details}` };
  }

  async function addToPlaylist(ctx, name, query) {
    const actor = actorOf(ctx);
    playlists.resolveEditable(ctx.guild.id, actor, name);
    if (query && isSpotifyLink(query)) {
      // Spotify tracks are saved without a YouTube match; it is found the first time they play.
      const resolved = await withLookup(ctx.guild.id, () => spotify.resolve(query, { limit: MAX_PLAYLIST_TRACKS }));
      const tracks = resolved.tracks.map((track) => spotifyItem(track));
      const { playlist, added, dropped } = playlists.addTracks(ctx.guild.id, actor, name, tracks);
      const what = resolved.kind === 'track'
        ? titleOf(tracks[0])
        : `${plural(added, 'track')} of Spotify ${resolved.kind} **${escapeMarkdown(shorten(resolved.name, 100))}**`;
      const note = dropped ? ` (${dropped} over the ${MAX_PLAYLIST_TRACKS}-track limit left out)` : '';
      return playlistResult(playlist,
        `➕ ${who(ctx)} added ${what} to playlist **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')})${note}`,
        `➕ Added ${what} to **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')})${note}.`);
    }
    let track;
    if (query) {
      track = await lookupTrack(ctx.guild.id, query);
    } else {
      track = activeState(ctx.guild.id)?.current;
      if (!track) throw new MusicError('Nothing is playing. Give me a YouTube or Spotify link or search text to add.');
      if (track.kind === 'radio') throw new MusicError('Radio stations cannot be saved in playlists.');
    }
    const { playlist } = playlists.addTracks(ctx.guild.id, actor, name, [track]);
    return playlistResult(playlist,
      `➕ ${who(ctx)} added ${titleOf(track)} to playlist **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')})`,
      `➕ Added ${describeItem(track)} to **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')}).`);
  }

  function saveQueue(ctx, name) {
    const state = activeState(ctx.guild.id);
    const items = state ? [state.current, ...state.queue].filter(Boolean) : [];
    if (!items.length) throw new MusicError('Nothing is playing, so there is no queue to save.');
    const { playlist, created, dropped } = playlists.saveTracks(ctx.guild.id, actorOf(ctx), name, items);
    const note = dropped ? ` (${dropped} over the limit left out)` : '';
    return playlistResult(playlist,
      `💾 ${who(ctx)} saved the queue as playlist **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')})${note}`,
      `💾 ${created ? 'Saved' : 'Replaced'} your playlist **${escapeMarkdown(playlist.name)}** with the queue (${plural(playlist.tracks.length, 'track')})${note}.`);
  }

  // Appends to the actor's playlist of that name, or creates a new private one.
  async function importPlaylist(ctx, name, url) {
    const actor = actorOf(ctx);
    const existing = playlists.findOwn(ctx.guild.id, actor.id, name);
    // Name and limits are checked before the slow lookup.
    if (!existing) playlists.assertCanCreate(ctx.guild.id, actor, name);
    const imported = await withLookup(ctx.guild.id, async () => {
      if (!isSpotifyLink(url)) return sources.resolvePlaylist(url);
      const resolved = await spotify.resolve(url, { limit: MAX_IMPORT_TRACKS });
      return { title: `Spotify ${resolved.kind} ${resolved.name}`, tracks: resolved.tracks.map((track) => spotifyItem(track)), skipped: 0 };
    });
    let playlist;
    let added;
    let dropped;
    if (existing) {
      ({ playlist, added, dropped } = playlists.addTracks(ctx.guild.id, actor, `#${existing.id}`, imported.tracks));
    } else {
      playlist = playlists.create(ctx.guild.id, actor, name, imported.tracks);
      added = playlist.tracks.length;
      dropped = imported.tracks.length - added;
    }
    const notes = [
      imported.skipped ? `${imported.skipped} unavailable skipped` : null,
      dropped ? `${dropped} over the ${MAX_PLAYLIST_TRACKS}-track limit left out` : null
    ].filter(Boolean).join(', ');
    const source = `**${escapeMarkdown(shorten(imported.title, 100))}**`;
    return playlistResult(playlist,
      `📥 ${who(ctx)} imported ${source} into playlist **${escapeMarkdown(playlist.name)}** (${plural(added, 'track')}${notes ? `; ${notes}` : ''})`,
      `📥 Imported ${source} into your playlist **${escapeMarkdown(playlist.name)}**: ${plural(added, 'track')}${notes ? ` (${notes})` : ''}.`);
  }

  async function runPlaylistCommand(ctx, interaction) {
    const { guild } = ctx;
    const actor = actorOf(ctx);
    const name = interaction.options.getString('name') || '';
    const ownerId = interaction.options.getUser?.('user')?.id || null;
    switch (interaction.options.getSubcommand()) {
      case 'create': {
        const playlist = playlists.create(guild.id, actor, name);
        return `📃 Created your private playlist **${escapeMarkdown(playlist.name)}**. Add tracks with \`/playlist add\`; \`/playlist visibility\` makes it public.`;
      }
      case 'delete': {
        const playlist = playlists.remove(guild.id, actor, name);
        schedulePanel(guild.id);
        return `🗑️ Deleted the playlist **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')}).`;
      }
      case 'rename': {
        const before = playlists.resolveEditable(guild.id, actor, name);
        const playlist = playlists.rename(guild.id, actor, name, interaction.options.getString('new_name', true));
        schedulePanel(guild.id);
        return `✏️ Renamed **${escapeMarkdown(before.name)}** to **${escapeMarkdown(playlist.name)}**.`;
      }
      case 'visibility': {
        const playlist = playlists.setVisibility(guild.id, actor, name, interaction.options.getString('mode', true));
        schedulePanel(guild.id);
        return playlist.visibility === 'public'
          ? `🌐 **${escapeMarkdown(playlist.name)}** is now public: everyone here can see and play it, only you can change it.`
          : `🔒 **${escapeMarkdown(playlist.name)}** is now private.`;
      }
      case 'copy': {
        const playlist = playlists.copy(guild.id, actor, name, ownerId, interaction.options.getString('new_name'));
        return `📋 Copied it into your private playlist **${escapeMarkdown(playlist.name)}** (${plural(playlist.tracks.length, 'track')}).`;
      }
      case 'add': return addToPlaylist(ctx, name, interaction.options.getString('query'));
      case 'remove': {
        const { playlist, removed } = playlists.removeTrack(guild.id, actor, name, interaction.options.getInteger('position', true));
        return `🗑️ Removed ${describeItem(removed)} from **${escapeMarkdown(playlist.name)}**.`;
      }
      case 'show': return { view: buildPlaylistView(playlists.resolve(guild.id, actor, name, ownerId)) };
      case 'list': return {
        view: ownerId
          ? buildPlaylistListView(playlists.listByOwner(guild.id, ownerId, actor), ownerId)
          : buildPlaylistListView(playlists.listVisible(guild.id, actor))
      };
      case 'play': return playPlaylist(ctx, playlists.resolve(guild.id, actor, name, ownerId), { shuffle: interaction.options.getBoolean?.('shuffle') === true });
      case 'save': return saveQueue(ctx, name);
      case 'import': return importPlaylist(ctx, name, interaction.options.getString('url', true));
      default: return 'Unknown playlist command.';
    }
  }

  // --- interaction entry points --------------------------------------------------------------

  async function respond(interaction, content) {
    const payload = { content: String(content).slice(0, 2000), allowedMentions: { parse: [] } };
    if (updateDeferred.has(interaction)) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else if (interaction.deferred) await interaction.editReply(payload);
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  async function respondView(interaction, payload) {
    if (updateDeferred.has(interaction)) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else if (interaction.deferred) await interaction.editReply({ content: null, ...payload });
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  // Posts a public message in the control channel; false when that is not possible.
  async function announceTo(guild, content) {
    try {
      const channel = guild ? await fetchChannel(guild, getMusicConfig(guild.id).controlChannelId) : null;
      if (!channel?.send) return false;
      await channel.send({ content: String(content).slice(0, 2000), allowedMentions: { parse: [] } });
      return true;
    } catch (error) {
      console.error(`Could not post a music announcement in guild ${guild.id}:`, error.message);
      return false;
    }
  }

  function announce(ctx, content) {
    return announceTo(ctx.guild, content);
  }

  function announceIn(guildId, content) {
    return announceTo(client.guilds.cache.get(guildId), content);
  }

  // After a public announcement the interaction needs no visible answer of its own.
  async function acknowledge(interaction) {
    if (updateDeferred.has(interaction)) return;
    if (interaction.deferred || interaction.replied) await interaction.deleteReply().catch(() => {});
    else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) await interaction.deferUpdate();
    else await interaction.reply({ content: '✅ Done.', flags: MessageFlags.Ephemeral });
  }

  // Results: a string (ephemeral reply), { view } (ephemeral embed), or { announce, reply? }.
  async function deliver(ctx, interaction, result) {
    if (typeof result === 'string') return respond(interaction, result);
    if (result.view) return respondView(interaction, result.view);
    const posted = result.announce ? await announce(ctx, result.announce) : false;
    if (result.reply) return respond(interaction, result.reply);
    if (posted) return acknowledge(interaction);
    return respond(interaction, result.announce);
  }

  // Resolves guild, member and the control channel check; replies and returns null when refused.
  async function getContext(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await respond(interaction, 'Music only works inside a server.');
      return null;
    }
    const { controlChannelId } = getMusicConfig(interaction.guildId);
    if (!controlChannelId) {
      await respond(interaction, 'The music channel is not set up yet. The bot needs the Manage Channels permission to create it.');
      return null;
    }
    if (interaction.channelId !== controlChannelId) {
      await respond(interaction, `Music commands only work in <#${controlChannelId}>.`);
      return null;
    }
    const member = interaction.member?.voice
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);
    return { interaction, guild: interaction.guild, member };
  }

  async function run(ctx, interaction, action) {
    let result;
    try {
      result = await action();
    } catch (error) {
      if (!(error instanceof MusicError)) throw error;
      await respond(interaction, error.message);
      return;
    }
    await deliver(ctx, interaction, result);
  }

  async function handleMusicCommand(interaction) {
    const ctx = await getContext(interaction);
    if (!ctx) return;

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await run(ctx, interaction, () => {
      switch (subcommand) {
        case 'play': return play(ctx, interaction.options.getString('query', true));
        case 'playnext': return play(ctx, interaction.options.getString('query', true), { next: true });
        case 'radio': return playRadio(ctx, interaction.options.getString('station', true));
        case 'continue': return continueSession(ctx);
        case 'skip': return skip(ctx);
        case 'stop': return stop(ctx);
        case 'pause': return pause(ctx);
        case 'resume': return resume(ctx);
        case 'shuffle': return shuffleQueue(ctx);
        case 'clear': return clearQueue(ctx);
        case 'remove': return removeFromQueue(ctx, interaction.options.getInteger('position', true));
        case 'move': return moveInQueue(ctx, interaction.options.getInteger('from', true), interaction.options.getInteger('to', true));
        case 'loop': return setLoop(ctx, interaction.options.getString('mode', true));
        case 'autoplay': return setAutoplay(ctx, interaction.options.getString('mode'));
        case 'queue': return showQueue(ctx);
        case 'nowplaying': return nowPlaying(ctx);
        case 'volume': return setVolume(ctx, interaction.options.getInteger('level', true));
        default: return 'Unknown music command.';
      }
    });
  }

  async function handlePlaylistCommand(interaction) {
    const ctx = await getContext(interaction);
    if (!ctx) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await run(ctx, interaction, () => runPlaylistCommand(ctx, interaction));
  }

  async function handleStationAutocomplete(interaction) {
    const query = normalizeName(interaction.options.getFocused());
    const stations = interaction.guildId ? listStations(getMusicConfig(interaction.guildId).stations) : listStations();
    await interaction.respond(stations
      .filter((station) => normalizeName(station.name).includes(query))
      .slice(0, 25)
      .map((station) => ({ name: station.name.slice(0, 100), value: station.key })));
  }

  const EDITING_SUBCOMMANDS = new Set(['delete', 'rename', 'visibility', 'add', 'remove', 'save', 'import']);

  function ownerName(guild, ownerId) {
    return guild?.members?.cache?.get(ownerId)?.displayName || client.users?.cache?.get(ownerId)?.username || 'someone';
  }

  // Own playlists first (by name), then public ones of others as "Name — by Owner".
  async function handlePlaylistAutocomplete(interaction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    // memberPermissions/member.permissions are getters on the prototype; never copy the member.
    const manager = env.PRIVILEGED_USER_IDS.has(String(interaction.user.id))
      || interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild) === true
      || interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) === true;
    const actor = { id: String(interaction.user.id), isManager: manager };
    const ownerId = interaction.options.get?.('user')?.value || null;
    let suggestions = playlists.suggest(interaction.guildId, actor, interaction.options.getFocused(), { editable: EDITING_SUBCOMMANDS.has(subcommand) });
    // save/import name the actor's own playlist; play/show/copy may filter by owner.
    if (subcommand === 'save' || subcommand === 'import') suggestions = suggestions.filter((entry) => entry.own);
    if (ownerId) suggestions = suggestions.filter((entry) => entry.playlist.ownerId === String(ownerId));
    await interaction.respond(suggestions.slice(0, 25).map(({ playlist, own, value }) => ({
      name: shorten(own ? playlist.name : `${playlist.name} — by ${ownerName(interaction.guild, playlist.ownerId)}`, 100),
      value
    })));
  }

  // Page buttons of the ephemeral views: music-page:<queue|playlist|list>:<arg>:<page>.
  async function handlePageButton(interaction, ctx) {
    const [view, arg, rawPage] = interaction.customId.slice(PAGE_PREFIX.length).split(':');
    const page = Number.parseInt(rawPage, 10) || 0;
    const actor = actorOf(ctx);
    let payload = null;
    if (view === 'queue') {
      payload = buildQueueView(getPanelState(ctx.guild.id), page);
    } else if (view === 'playlist') {
      const playlist = playlists.findById(ctx.guild.id, arg);
      if (playlist && canRead(playlist, actor)) payload = buildPlaylistView(playlist, page);
    } else if (view === 'list') {
      payload = arg === '-'
        ? buildPlaylistListView(playlists.listVisible(ctx.guild.id, actor), null, page)
        : buildPlaylistListView(playlists.listByOwner(ctx.guild.id, arg, actor), arg, page);
    }
    if (!payload) {
      await respond(interaction, 'That playlist is gone or private.');
      return;
    }
    await interaction.update(payload);
  }

  // Panel buttons and selects plus the page buttons; returns false for other interactions.
  async function handlePanelInteraction(interaction) {
    const isComponent = interaction.isButton?.() || interaction.isStringSelectMenu?.();
    const isPage = interaction.isButton?.() && String(interaction.customId).startsWith(PAGE_PREFIX);
    const isSkip = interaction.isButton?.() && String(interaction.customId).startsWith(SKIP_PREFIX);
    if (!isComponent || (!PANEL_CUSTOM_IDS.has(interaction.customId) && !isPage && !isSkip)) return false;
    const ctx = await getContext(interaction);
    if (!ctx) return true;
    if (isPage) {
      await handlePageButton(interaction, ctx);
      return true;
    }

    const { customId } = interaction;
    if (customId === PANEL_IDS.station || customId === PANEL_IDS.playlist || customId === PANEL_IDS.resume) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await run(ctx, interaction, () => {
        if (customId === PANEL_IDS.station) return playRadio(ctx, interaction.values[0]);
        if (customId === PANEL_IDS.resume) return continueSession(ctx);
        const playlist = playlists.findById(ctx.guild.id, interaction.values[0]);
        if (!playlist || !canRead(playlist, actorOf(ctx))) throw new MusicError('That playlist is gone or private.');
        return playPlaylist(ctx, playlist);
      });
      return true;
    }

    // Acknowledge first (within Discord's 3 seconds); answers then come as ephemeral follow-ups.
    await interaction.deferUpdate();
    updateDeferred.add(interaction);
    await run(ctx, interaction, () => {
      if (customId === PANEL_IDS.pause) return states.get(ctx.guild.id)?.paused ? resume(ctx) : pause(ctx);
      if (customId === PANEL_IDS.skip) return skip(ctx);
      if (customId.startsWith(SKIP_PREFIX)) return skip(ctx, customId.slice(SKIP_PREFIX.length));
      if (customId === PANEL_IDS.stop) return stop(ctx);
      if (customId === PANEL_IDS.shuffle) return shuffleQueue(ctx);
      if (customId === PANEL_IDS.loop) return setLoop(ctx);
      if (customId === PANEL_IDS.autoplay) return setAutoplay(ctx);
      if (customId === PANEL_IDS.queue) return showQueue(ctx);
      const step = customId === PANEL_IDS.volumeUp ? VOLUME_STEP : -VOLUME_STEP;
      return setVolume(ctx, getMusicConfig(ctx.guild.id).volume + step);
    });
    return true;
  }

  // Called after /setup changed the music config: apply the volume live and rebuild the panel
  // (a new control channel has no panel message yet).
  // `previous` is the music config before the change; a new Voice role is applied to the channel.
  async function applyConfig(guildId, previous = null) {
    const config = getMusicConfig(guildId);
    states.get(guildId)?.resource?.volume?.setVolume(config.volume / 100);
    schedulePanel(guildId);
    if (previous && previous.roleId !== config.roleId && config.controlChannelId) {
      const guild = client.guilds.cache.get(guildId);
      const channel = guild ? await fetchChannel(guild, config.controlChannelId).catch(() => null) : null;
      if (channel) await applyChannelAccess(guild, channel, previous.roleId);
    }
  }

  return {
    ensureControlChannel,
    applyConfig,
    refreshPanel,
    handleMusicCommand,
    handlePlaylistCommand,
    handleStationAutocomplete,
    handlePlaylistAutocomplete,
    handlePanelInteraction,
    handleMessageCreate,
    handleMessageDelete
  };
}

module.exports = { createMusicFeature, PANEL_IDS, MAX_QUEUE, MAX_PLAYLIST_QUEUE };
