const { ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');

const dns = require('node:dns');

const { createMusicSources, MusicError } = require('./sources');
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
  escapeMarkdown,
  formatDuration,
  shorten
} = require('./panel');
const { assertPublicStationUrl } = require('./urlSafety');
const { nextLoopMode, shuffled, removeAt, moveItem, LOOP_MODES } = require('./queue');
const { createPlaylistStore, canRead, MAX_PLAYLIST_TRACKS } = require('./playlists');
const { createResumeStore } = require('./resume');

const MAX_QUEUE = 50;
// Playlists (and /music continue) may fill the queue further.
const MAX_PLAYLIST_QUEUE = 100;
const VOLUME_STEP = 10;
// yt-dlp lookups: one per server at a time, a few across all servers.
const MAX_LOOKUPS = 3;
// A track that ended this quickly failed (or was removed); loops skip it instead of retrying forever.
const MIN_LOOP_PLAY_MS = 3_000;
// Channel cleanup: bulk delete only works for messages younger than 14 days.
const BULK_DELETE_MAX_AGE_MS = (14 * 24 * 60 - 60) * 60_000;
const CLEANUP_MAX_PAGES = 5;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;
const PANEL_CUSTOM_IDS = new Set(Object.values(PANEL_IDS));

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
  lookup = dns.promises.lookup,
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

  voiceSessions.onEnd((session, reason) => {
    const state = states.get(session.guildId);
    if (state?.session === session) {
      saveSnapshot(state, { reason: reason || 'session ended' });
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
      state = { session, queue: [], current: null, paused: false, loop: 'off', child: null, resource: null, offset: 0, failed: false };
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
    // The player itself tears down the old audio pipeline; this ends the processes feeding it.
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
    const seek = item.kind === 'track' && !item.isLive && startAt > 0 ? Math.floor(startAt) : 0;
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

    state.current = item;
    state.child = child;
    state.resource = resource;
    state.offset = seek;
    state.failed = false;
    state.paused = false;
    cancelCleanup(state.session.guildId);
    state.session.musicPlayer.play(resource);
    schedulePanel(state.session.guildId);
  }

  // Next item after the current one ended (or was skipped), following the loop mode.
  function playNext(state, { skipped = false } = {}) {
    const finished = state.current;
    const failed = !skipped && (state.failed || (state.resource?.playbackDuration || 0) < MIN_LOOP_PLAY_MS);
    const loopable = finished?.kind === 'track' && !finished.isLive && !failed;
    stopProcess(state);
    state.current = null;
    state.paused = false;
    if (isActive(state) && loopable && !skipped && state.loop === 'track') {
      startItem(state, finished);
      return;
    }
    if (loopable && state.loop === 'queue') state.queue.push(finished);
    const next = state.queue.shift();
    if (next && isActive(state)) {
      startItem(state, next);
      return;
    }
    state.session.musicPlayer.stop(true);
    schedulePanel(state.session.guildId);
    scheduleCleanup(state.session.guildId);
  }

  function stopAll(state, savedBy = null) {
    saveSnapshot(state, { savedBy, reason: 'stopped' });
    state.queue = [];
    stopProcess(state);
    state.current = null;
    state.paused = false;
    state.session.musicPlayer.stop(true);
    schedulePanel(state.session.guildId);
    scheduleCleanup(state.session.guildId);
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

  // Panel writes and cleanups per guild run one after another so a deleted panel is only re-posted once.
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

  // Deletes every message of the control channel except the panel while nothing plays. Failures
  // are ignored. If an older message survives, the panel is posted again unless it already is the newest.
  async function cleanChannel(guildId) {
    if (!isIdle(guildId)) return;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild ? await fetchChannel(guild, getMusicConfig(guildId).controlChannelId) : null;
    if (!channel?.messages?.fetch) return;

    const messages = await fetchRecentMessages(channel);
    if (!isIdle(guildId)) return;
    const { panelMessageId } = getMusicConfig(guildId);
    const panel = messages.find((message) => message.id === panelMessageId) || null;
    const others = messages.filter((message) => message.id !== panelMessageId);
    const cutoff = now() - BULK_DELETE_MAX_AGE_MS;
    const recent = others.filter((message) => message.createdTimestamp > cutoff);
    const old = others.filter((message) => message.createdTimestamp <= cutoff);
    const deleted = new Set();

    for (let index = 0; index < recent.length; index += 100) {
      const chunk = recent.slice(index, index + 100);
      if (chunk.length === 1 || !channel.bulkDelete) {
        for (const message of chunk) {
          if (await message.delete().then(() => true, () => false)) deleted.add(message.id);
        }
        continue;
      }
      try {
        const result = await channel.bulkDelete(chunk.map((message) => message.id));
        for (const id of result?.keys?.() || []) deleted.add(id);
      } catch {
        // Missing Manage Messages or already deleted: leave them.
      }
    }
    for (const message of old) {
      if (await message.delete().then(() => true, () => false)) deleted.add(message.id);
    }

    const remaining = others.filter((message) => !deleted.has(message.id));
    const olderLeft = panel && remaining.some((message) => message.createdTimestamp < panel.createdTimestamp);
    const newerLeft = panel && remaining.some((message) => message.createdTimestamp > panel.createdTimestamp);
    if (!panel || (olderLeft && newerLeft)) {
      if (panel) {
        updateMusicConfig(guildId, { panelMessageId: null });
        await panel.delete().catch(() => {});
      }
      await writePanel(guildId);
    }
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
      if (isIdle(guildId)) void enqueue(guildId, () => cleanChannel(guildId), 'Music channel cleanup');
    }, cleanupDelayMs);
    timer.unref?.();
    cleanupTimers.set(guildId, timer);
  }

  async function refreshAndClean(guildId) {
    await refreshPanel(guildId);
    if (isIdle(guildId)) await enqueue(guildId, () => cleanChannel(guildId), 'Music channel cleanup');
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
    return `**${escapeMarkdown(shorten(item.title, 100))}**`;
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

  // Runs one yt-dlp lookup with the per-server and global limits.
  async function withLookup(guildId, task) {
    if (lookupGuilds.has(guildId) || lookupGuilds.size >= MAX_LOOKUPS) {
      throw new MusicError('⏳ I am busy looking up another track. Try again in a moment.');
    }
    lookupGuilds.add(guildId);
    try {
      return await task();
    } finally {
      lookupGuilds.delete(guildId);
    }
  }

  function lookupTrack(guildId, query) {
    return withLookup(guildId, () => sources.resolveTrack(query));
  }

  async function play(ctx, query, { next = false } = {}) {
    checkVoiceChannel(ctx);
    const track = await lookupTrack(ctx.guild.id, query);
    const state = getState(await ensureSession(ctx));
    const item = { ...track, requesterId: ctx.member.id };
    const label = `${titleOf(item)} (${describeLength(item)})`;

    if (!state.current || state.current.kind === 'radio') {
      const replacedRadio = state.current?.kind === 'radio';
      startItem(state, item);
      return { announce: `▶️ ${who(ctx)} started ${label}${replacedRadio ? ' and stopped the radio' : ''}` };
    }
    if (state.queue.length >= MAX_QUEUE) throw new MusicError(`The queue is full (${MAX_QUEUE} tracks).`);
    if (next) state.queue.unshift(item);
    else state.queue.push(item);
    schedulePanel(ctx.guild.id);
    return { announce: next ? `⏫ ${who(ctx)} added ${label} — up next` : `🎵 ${who(ctx)} added ${label} — position ${state.queue.length}` };
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
    startItem(state, radioItem(station, url, ctx.member.id));
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
    startItem(state, { ...first }, { startAt });
    // Used up; if this session is interrupted again, that saves a new snapshot.
    resumeStore.clear(ctx.guild.id);
    const count = 1 + state.queue.length;
    const at = startAt > 0 ? ` at ${formatDuration(startAt)}` : '';
    return { announce: `⏯️ ${who(ctx)} continued the last session (${plural(count, 'track')}) with ${titleOf(first)}${at}` };
  }

  function skip(ctx) {
    const state = requireControl(ctx);
    const skipped = state.current;
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
    state.queue = shuffled(state.queue, random);
    schedulePanel(ctx.guild.id);
    return { announce: `🔀 ${who(ctx)} shuffled the queue (${plural(state.queue.length, 'track')})` };
  }

  function clearQueue(ctx) {
    const state = requireControl(ctx);
    const count = state.queue.length;
    if (!count) throw new MusicError('The queue is already empty.');
    state.queue = [];
    schedulePanel(ctx.guild.id);
    return { announce: `🧹 ${who(ctx)} cleared the queue (${plural(count, 'track')})` };
  }

  function removeFromQueue(ctx, position) {
    const state = requireControl(ctx);
    const { queue, removed } = removeAt(state.queue, position);
    state.queue = queue;
    schedulePanel(ctx.guild.id);
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
    schedulePanel(ctx.guild.id);
    const text = { off: 'turned looping **off**', track: 'set loop to **this track**', queue: 'set loop to **the whole queue**' }[next];
    return { announce: `${next === 'track' ? '🔂' : '🔁'} ${who(ctx)} ${text}` };
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
      `${current.kind === 'radio' ? 'Radio station' : `YouTube${current.author ? ` · ${escapeMarkdown(current.author)}` : ''}`} · ${position}`,
      `Requested by <@${current.requesterId}>`
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
    const items = (shuffle ? shuffled(playlist.tracks, random) : playlist.tracks).map((track) => ({
      kind: 'track',
      ...track,
      source: 'YouTube',
      author: null,
      thumbnail: null,
      requesterId: ctx.member.id
    }));
    const startNow = !state.current || state.current.kind === 'radio';
    const first = startNow ? items.shift() : null;
    const room = Math.max(0, MAX_PLAYLIST_QUEUE - state.queue.length);
    if (!first && !room) throw new MusicError(`The queue is full (${MAX_PLAYLIST_QUEUE} tracks).`);
    const queued = items.slice(0, room);
    const dropped = items.length - queued.length;
    state.queue.push(...queued);
    if (first) startItem(state, first);
    else schedulePanel(ctx.guild.id);
    playlists.markUsed(ctx.guild.id, playlist.id);
    schedulePanel(ctx.guild.id);

    const count = queued.length + (first ? 1 : 0);
    const by = playlist.ownerId !== String(ctx.member.id) ? ` by <@${playlist.ownerId}>` : '';
    return {
      announce: `📃 ${who(ctx)} queued playlist **${escapeMarkdown(playlist.name)}**${by} (${plural(count, 'track')}${shuffle ? ', shuffled' : ''})`
        + (dropped ? ` — the queue is limited to ${MAX_PLAYLIST_QUEUE} tracks, ${dropped} not queued` : '')
    };
  }

  async function addToPlaylist(ctx, name, query) {
    const actor = actorOf(ctx);
    playlists.resolveEditable(ctx.guild.id, actor, name);
    let track;
    if (query) {
      track = await lookupTrack(ctx.guild.id, query);
    } else {
      track = activeState(ctx.guild.id)?.current;
      if (!track) throw new MusicError('Nothing is playing. Give me a YouTube link or search text to add.');
      if (track.kind === 'radio') throw new MusicError('Radio stations cannot be saved in playlists.');
    }
    const { playlist, added } = playlists.addTracks(ctx.guild.id, actor, name, [track]);
    if (!added) throw new MusicError('Only single YouTube videos can be saved in a playlist.');
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
    const imported = await withLookup(ctx.guild.id, () => sources.resolvePlaylist(url));
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
    if (interaction.deferred) await interaction.editReply(payload);
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  async function respondView(interaction, payload) {
    if (interaction.deferred) await interaction.editReply({ content: null, ...payload });
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  // Posts a public message in the control channel; false when that is not possible.
  async function announce(ctx, content) {
    try {
      const channel = await fetchChannel(ctx.guild, getMusicConfig(ctx.guild.id).controlChannelId);
      if (!channel?.send) return false;
      await channel.send({ content: String(content).slice(0, 2000), allowedMentions: { parse: [] } });
      return true;
    } catch (error) {
      console.error(`Could not post a music announcement in guild ${ctx.guild.id}:`, error.message);
      return false;
    }
  }

  // After a public announcement the interaction needs no visible answer of its own.
  async function acknowledge(interaction) {
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
    const member = interaction.member || { id: interaction.user.id };
    const actor = { id: String(interaction.user.id), isManager: isManager({ ...member, id: interaction.user.id }) };
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
    if (!isComponent || (!PANEL_CUSTOM_IDS.has(interaction.customId) && !isPage)) return false;
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

    await run(ctx, interaction, () => {
      if (customId === PANEL_IDS.pause) return states.get(ctx.guild.id)?.paused ? resume(ctx) : pause(ctx);
      if (customId === PANEL_IDS.skip) return skip(ctx);
      if (customId === PANEL_IDS.stop) return stop(ctx);
      if (customId === PANEL_IDS.shuffle) return shuffleQueue(ctx);
      if (customId === PANEL_IDS.loop) return setLoop(ctx);
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
