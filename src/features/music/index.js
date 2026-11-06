const { ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');

const dns = require('node:dns');

const { createMusicSources, MusicError } = require('./sources');
const { listStations, findStation } = require('./stations');
const { PANEL_IDS, buildPanelMessage, describeItem, formatDuration } = require('./panel');
const { assertPublicStationUrl } = require('./urlSafety');

const MAX_QUEUE = 50;
const VOLUME_STEP = 10;
// yt-dlp lookups: one per server at a time, a few across all servers.
const MAX_LOOKUPS = 3;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;
const PANEL_CUSTOM_IDS = new Set(Object.values(PANEL_IDS));

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

// Music and radio on the shared voice session (src/features/voice/sessions.js), only on its
// musicPlayer. Commands and the control panel live in one text channel per server ("voice").
function createMusicFeature({
  client,
  env,
  store,
  voiceSessions,
  voice = require('@discordjs/voice'),
  sources = createMusicSources({ ytdlpPath: env.YTDLP_PATH }),
  lookup = dns.promises.lookup,
  panelDelayMs = 2_000
}) {
  // guildId -> { session, queue, current, paused, child, resource }; `paused` is what the user asked for.
  const states = new Map();
  const panelTimers = new Map();
  const panelChains = new Map();
  const lookupGuilds = new Set();

  voiceSessions.onEnd((session) => {
    const state = states.get(session.guildId);
    if (state?.session === session) {
      stopProcess(state);
      states.delete(session.guildId);
    }
    schedulePanel(session.guildId);
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

  function getState(session) {
    let state = states.get(session.guildId);
    if (state?.session !== session) {
      state = { session, queue: [], current: null, paused: false, child: null, resource: null };
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
    }
    return state;
  }

  function stopProcess(state) {
    // The player itself tears down the old audio pipeline; this ends the processes feeding it.
    state.child?.kill('SIGKILL');
    state.child = null;
    state.resource = null;
  }

  function startItem(state, item) {
    stopProcess(state);
    const child = item.kind === 'radio' ? sources.spawnRadio(item.url) : sources.spawnTrack(item.url);
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
    state.paused = false;
    state.session.musicPlayer.play(resource);
    schedulePanel(state.session.guildId);
  }

  function playNext(state) {
    stopProcess(state);
    state.current = null;
    state.paused = false;
    const next = state.queue.shift();
    if (next && isActive(state)) {
      startItem(state, next);
      return;
    }
    state.session.musicPlayer.stop(true);
    schedulePanel(state.session.guildId);
  }

  function stopAll(state) {
    state.queue = [];
    stopProcess(state);
    state.current = null;
    state.paused = false;
    state.session.musicPlayer.stop(true);
    schedulePanel(state.session.guildId);
  }

  // --- control panel -------------------------------------------------------------------------

  function getPanelState(guildId) {
    const session = voiceSessions.get(guildId);
    const state = session ? states.get(guildId) : null;
    const config = getMusicConfig(guildId);
    return {
      current: state?.session === session ? state?.current || null : null,
      queue: state?.session === session ? state?.queue || [] : [],
      paused: Boolean(state?.paused),
      volume: config.volume,
      channelId: session?.channelId || null,
      stations: listStations(config.stations)
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
  function refreshPanel(guildId) {
    const previous = panelChains.get(guildId) || Promise.resolve();
    const next = previous
      .then(() => writePanel(guildId))
      .catch((error) => console.error(`Music panel update failed in guild ${guildId}:`, error.message));
    panelChains.set(guildId, next);
    return next;
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

  // Uses the stored channel; otherwise sets one up once per server (one named MUSIC_CHANNEL_NAME,
  // else a new one) and then posts the panel. After that first setup a channel that admins cleared
  // or deleted stays unset, and /music says so.
  async function ensureControlChannel(guild) {
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
      await refreshPanel(guild.id);
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
          topic: 'Music and radio: use /music here. The panel below shows what is playing.',
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
      await refreshPanel(guild.id);
      return fetchChannel(guild, latest.controlChannelId).catch(() => null);
    }
    updateMusicConfig(guild.id, {
      autoSetupDone: true,
      ...(channel.id !== latest.controlChannelId ? { controlChannelId: channel.id, panelMessageId: null } : {})
    });
    await refreshPanel(guild.id);
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

  // --- actions shared by commands and panel --------------------------------------------------

  function isManager(member) {
    return env.PRIVILEGED_USER_IDS.has(String(member.id))
      || member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) === true;
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
  async function lookupTrack(guildId, query) {
    if (lookupGuilds.has(guildId) || lookupGuilds.size >= MAX_LOOKUPS) {
      throw new MusicError('⏳ I am busy looking up another track. Try again in a moment.');
    }
    lookupGuilds.add(guildId);
    try {
      return await sources.resolveTrack(query);
    } finally {
      lookupGuilds.delete(guildId);
    }
  }

  async function play(ctx, query) {
    checkVoiceChannel(ctx);
    const track = await lookupTrack(ctx.guild.id, query);
    const state = getState(await ensureSession(ctx));
    const item = { ...track, requesterId: ctx.member.id };

    if (!state.current || state.current.kind === 'radio') {
      const replacedRadio = state.current?.kind === 'radio';
      startItem(state, item);
      return `▶️ Now playing ${describeItem(item)}${replacedRadio ? ' (stopped the radio)' : ''}`;
    }
    if (state.queue.length >= MAX_QUEUE) throw new MusicError(`The queue is full (${MAX_QUEUE} tracks).`);
    state.queue.push(item);
    schedulePanel(ctx.guild.id);
    return `➕ Queued at position ${state.queue.length}: ${describeItem(item)}`;
  }

  async function playRadio(ctx, stationKey) {
    const station = findStation(stationKey, getMusicConfig(ctx.guild.id).stations);
    if (!station) throw new MusicError('Unknown station. Pick one from the list.');
    checkVoiceChannel(ctx);
    let url = station.url;
    if (station.custom) {
      try {
        url = await assertPublicStationUrl(station.url, { lookup });
      } catch (error) {
        throw new MusicError(`Can't play **${station.name}**: ${error.message}`);
      }
    }
    const state = getState(await ensureSession(ctx));
    const dropped = state.queue.length;
    state.queue = [];
    startItem(state, {
      kind: 'radio',
      title: station.name,
      url,
      stationKey: station.key,
      source: 'Radio',
      isLive: true,
      duration: null,
      requesterId: ctx.member.id
    });
    return `📻 Tuned in to **${station.name}**.${dropped ? ` Cleared ${dropped} queued track${dropped === 1 ? '' : 's'}.` : ''}`;
  }

  function skip(ctx) {
    const state = requireControl(ctx);
    const skipped = state.current;
    playNext(state);
    return `⏭️ Skipped **${skipped.title}**.${state.current ? ` Now playing ${describeItem(state.current)}` : ''}`;
  }

  function stop(ctx) {
    stopAll(requireControl(ctx));
    return '⏹️ Stopped playback and cleared the queue.';
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

  function showQueue(ctx) {
    const { current, queue } = getPanelState(ctx.guild.id);
    if (!current) return 'Nothing is playing right now.';
    const lines = [`**Now:** ${describeItem(current)} · <@${current.requesterId}>`];
    queue.slice(0, 10).forEach((item, index) => lines.push(`${index + 1}. ${describeItem(item)} · <@${item.requesterId}>`));
    if (queue.length > 10) lines.push(`…and ${queue.length - 10} more`);
    if (!queue.length) lines.push('The queue is empty.');
    return lines.join('\n');
  }

  function nowPlaying(ctx) {
    const { current, paused } = getPanelState(ctx.guild.id);
    if (!current) return 'Nothing is playing right now.';
    const state = states.get(ctx.guild.id);
    const elapsed = Math.floor((state?.resource?.playbackDuration || 0) / 1000);
    const position = current.isLive ? '🔴 Live' : `${formatDuration(elapsed)} / ${formatDuration(current.duration)}`;
    return [
      `${paused ? '⏸️' : '▶️'} ${describeItem(current)}`,
      `${current.kind === 'radio' ? 'Radio station' : `YouTube${current.author ? ` · ${current.author}` : ''}`} · ${position}`,
      `Requested by <@${current.requesterId}>`
    ].join('\n');
  }

  // --- interaction entry points --------------------------------------------------------------

  async function respond(interaction, content) {
    const payload = { content: String(content).slice(0, 2000), allowedMentions: { parse: [] } };
    if (interaction.deferred) await interaction.editReply(payload);
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
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

  async function run(interaction, action) {
    try {
      await respond(interaction, await action());
    } catch (error) {
      if (!(error instanceof MusicError)) throw error;
      await respond(interaction, error.message);
    }
  }

  async function handleMusicCommand(interaction) {
    const ctx = await getContext(interaction);
    if (!ctx) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'play' || subcommand === 'radio') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    await run(interaction, () => {
      switch (subcommand) {
        case 'play': return play(ctx, interaction.options.getString('query', true));
        case 'radio': return playRadio(ctx, interaction.options.getString('station', true));
        case 'skip': return skip(ctx);
        case 'stop': return stop(ctx);
        case 'pause': return pause(ctx);
        case 'resume': return resume(ctx);
        case 'queue': return showQueue(ctx);
        case 'nowplaying': return nowPlaying(ctx);
        case 'volume': return setVolume(ctx, interaction.options.getInteger('level', true));
        default: return 'Unknown music command.';
      }
    });
  }

  async function handleStationAutocomplete(interaction) {
    const query = normalizeName(interaction.options.getFocused());
    const stations = interaction.guildId ? listStations(getMusicConfig(interaction.guildId).stations) : listStations();
    await interaction.respond(stations
      .filter((station) => normalizeName(station.name).includes(query))
      .slice(0, 25)
      .map((station) => ({ name: station.name.slice(0, 100), value: station.key })));
  }

  // Panel buttons and the station select; returns false for other interactions.
  async function handlePanelInteraction(interaction) {
    if (!(interaction.isButton?.() || interaction.isStringSelectMenu?.()) || !PANEL_CUSTOM_IDS.has(interaction.customId)) {
      return false;
    }
    const ctx = await getContext(interaction);
    if (!ctx) return true;

    const { customId } = interaction;
    if (customId === PANEL_IDS.station) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await run(interaction, () => playRadio(ctx, interaction.values[0]));
      return true;
    }

    await run(interaction, () => {
      if (customId === PANEL_IDS.pause) return states.get(ctx.guild.id)?.paused ? resume(ctx) : pause(ctx);
      if (customId === PANEL_IDS.skip) return skip(ctx);
      if (customId === PANEL_IDS.stop) return stop(ctx);
      const step = customId === PANEL_IDS.volumeUp ? VOLUME_STEP : -VOLUME_STEP;
      return setVolume(ctx, getMusicConfig(ctx.guild.id).volume + step);
    });
    return true;
  }

  // Called after /setup changed the music config: apply the volume live and rebuild the panel
  // (a new control channel has no panel message yet).
  function applyConfig(guildId) {
    states.get(guildId)?.resource?.volume?.setVolume(getMusicConfig(guildId).volume / 100);
    schedulePanel(guildId);
  }

  return {
    ensureControlChannel,
    applyConfig,
    refreshPanel,
    handleMusicCommand,
    handleStationAutocomplete,
    handlePanelInteraction,
    handleMessageDelete
  };
}

module.exports = { createMusicFeature, PANEL_IDS };
