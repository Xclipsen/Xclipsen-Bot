const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

process.env.DISCORD_TOKEN ||= 'test-token';

const { ChannelType, Collection, MessageFlags, PermissionsBitField } = require('discord.js');
const { createMusicFeature, PANEL_IDS } = require('../src/features/music');
const { createMusicSources } = require('../src/features/music/sources');
const { buildPanelMessage } = require('../src/features/music/panel');
const { BUILT_IN_STATIONS, listStations } = require('../src/features/music/stations');
const { createVoiceSessions } = require('../src/features/voice/sessions');
const { createPlaylistStore } = require('../src/features/music/playlists');
const { createResumeStore } = require('../src/features/music/resume');

const CONTROL_CHANNEL_ID = 'voice-ch';

function createFakeVoice() {
  const voice = {
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed', Signalling: 'signalling', Connecting: 'connecting' },
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing', Paused: 'paused' },
    NoSubscriberBehavior: { Pause: 'pause', Play: 'play' },
    StreamType: { Arbitrary: 'arbitrary', Raw: 'raw' },
    players: [],
    joinVoiceChannel(options) {
      const connection = new EventEmitter();
      connection.options = options;
      connection.state = { status: 'ready' };
      connection.subscribe = (player) => { connection.subscribed = player; };
      connection.destroy = () => {
        connection.state = { status: 'destroyed' };
        connection.emit('destroyed');
      };
      return connection;
    },
    createAudioPlayer(options = {}) {
      const player = new EventEmitter();
      player.behaviors = { noSubscriber: 'pause', ...options.behaviors };
      player.played = [];
      player.status = 'idle';
      player.play = (resource) => {
        player.resource = resource;
        player.played.push(resource);
        player.status = 'playing';
        player.emit('playing');
      };
      // Like @discordjs/voice: stop() goes idle and reports the resource that was playing.
      player.stop = () => {
        if (player.status === 'idle') return false;
        const oldState = { status: player.status, resource: player.resource };
        player.status = 'idle';
        player.resource = null;
        player.emit('idle', oldState, { status: 'idle' });
        return true;
      };
      // Like @discordjs/voice: pause() only works while Playing, unpause() only while Paused.
      player.setStatus = (status) => {
        const oldState = { status: player.status, resource: player.resource };
        player.status = status;
        player.emit(status, oldState, { status, resource: player.resource });
      };
      player.pause = () => {
        if (player.status !== 'playing') return false;
        player.setStatus('paused');
        return true;
      };
      player.unpause = () => {
        if (player.status !== 'paused') return false;
        player.setStatus('playing');
        return true;
      };
      player.finish = () => player.stop();
      voice.players.push(player);
      return player;
    },
    createAudioResource(stream, options) {
      const volume = { value: null, setVolume(value) { this.value = value; } };
      return { stream, options, volume, playbackDuration: 65_000 };
    },
    entersState: async () => {}
  };
  return voice;
}

// Fake child_process.spawn: metadata lookups answer with `videos[target]`, streams stay open until killed.
function createFakeSpawn(videos = {}) {
  const calls = [];
  function spawn(command, args, options = {}) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.signals = [];
    child.kill = (signal) => {
      child.killed = true;
      child.signals.push(signal);
      return true;
    };
    calls.push({ command, args, options, child });

    if (args.includes('--dump-single-json')) {
      const target = args[args.length - 1];
      setImmediate(() => {
        const info = videos[target];
        if (info) child.stdout.write(JSON.stringify(info));
        else child.stderr.write('ERROR: [youtube] xyz: Video unavailable');
        child.exitCode = info ? 0 : 1;
        child.emit('close', child.exitCode);
      });
    }
    return child;
  }
  spawn.calls = calls;
  return spawn;
}

const VIDEOS = {
  'ytsearch1:lofi beats': { entries: [{ id: 'a1', title: 'Lofi Beats', webpage_url: 'https://www.youtube.com/watch?v=a1', duration: 185, channel: 'Lofi Girl' }] },
  'ytsearch1:second song': { entries: [{ id: 'b2', title: 'Second Song', webpage_url: 'https://www.youtube.com/watch?v=b2', duration: 200 }] },
  'ytsearch1:very long': { entries: [{ id: 'c3', title: 'Ten Hours', webpage_url: 'https://www.youtube.com/watch?v=c3', duration: 36_000 }] },
  'https://youtu.be/live1': { id: 'live1', title: 'Live Radio 2026-11-06 18:48', webpage_url: 'https://www.youtube.com/watch?v=live1', is_live: true, live_status: 'is_live', duration: null }
};

function createFakeStore(music = {}) {
  const guilds = { g1: { music: { controlChannelId: CONTROL_CHANNEL_ID, panelMessageId: null, stations: [], volume: 50, ...music } } };
  return {
    getGuildConfig: (guildId) => ({ music: { controlChannelId: null, panelMessageId: null, stations: [], volume: 50, ...guilds[guildId]?.music } }),
    setGuildConfig: (guildId, partial) => { guilds[guildId] = { ...guilds[guildId], ...partial }; },
    guilds
  };
}

function createTextChannel(id, name = 'voice') {
  const messages = new Map();
  let nextId = 1;
  let clock = Date.now() - 60_000;
  const channel = {
    id,
    name,
    type: ChannelType.GuildText,
    messages: {
      // fetch(id) or fetch({ limit, before }) like discord.js (newest first).
      fetch: async (query) => {
        if (channel.fetchError) throw channel.fetchError;
        if (query && typeof query === 'object') {
          const list = [...messages.values()]
            .filter((message) => !query.before || message.createdTimestamp < messages.get(query.before)?.createdTimestamp)
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
            .slice(0, query.limit || 50);
          return new Collection(list.map((message) => [message.id, message]));
        }
        if (!messages.has(query)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return messages.get(query);
      }
    },
    async bulkDelete(ids) {
      channel.bulkDeletes.push(ids);
      const result = new Collection();
      for (const messageId of ids) {
        const message = messages.get(messageId);
        if (!message || message.undeletable) continue;
        messages.delete(messageId);
        channel.deleted.push(messageId);
        result.set(messageId, message);
      }
      return result;
    },
    // A message from someone else, e.g. chat in the music channel; `ageMs` back-dates it.
    addMessage({ content = 'hi', ageMs = null, undeletable = false } = {}) {
      const message = channel.createMessage({ content });
      if (ageMs !== null) message.createdTimestamp = Date.now() - ageMs;
      message.undeletable = undeletable;
      return message;
    },
    createMessage(payload) {
      const message = {
        id: `m${nextId++}`,
        payload,
        createdTimestamp: (clock += 1000),
        edit: async (next) => { message.payload = next; channel.edits.push(next); },
        delete: async () => {
          if (message.undeletable) throw new Error('Missing Permissions');
          messages.delete(message.id);
          channel.deleted.push(message.id);
        }
      };
      messages.set(message.id, message);
      return message;
    },
    messageIds: () => [...messages.keys()],
    bulkDeletes: [],
    sent: [],
    edits: [],
    deleted: [],
    overwrites: new Map(),
    permissionOverwrites: {
      edit: async (id, options) => { channel.overwrites.set(id, { ...channel.overwrites.get(id), ...options }); },
      delete: async (id) => { channel.overwrites.delete(id); }
    },
    async send(payload) {
      const message = channel.createMessage(payload);
      channel.sent.push(payload);
      return message;
    },
    // Public text messages the bot posted (not the panel).
    announcements: () => channel.sent.filter((payload) => typeof payload.content === 'string' && !payload.embeds).map((payload) => payload.content),
    lastAnnouncement: () => channel.announcements().at(-1),
    deleteMessage: (messageId) => messages.delete(messageId)
  };
  return channel;
}

function createGuild({ channels = [createTextChannel(CONTROL_CHANNEL_ID)], canCreate = true, roles = [] } = {}) {
  const cache = new Collection(channels.map((channel) => [channel.id, channel]));
  const roleCache = new Collection([['g1', { id: 'g1', name: '@everyone' }], ...roles.map((role) => [role.id, role])]);
  const guild = {
    id: 'g1',
    name: 'Guild',
    roles: {
      cache: roleCache,
      everyone: roleCache.get('g1'),
      createdRoles: [],
      fetch: async (id) => roleCache.get(id) || null,
      async create(options) {
        if (!canCreate) throw new Error('Missing Permissions');
        const role = { id: 'voice-role', name: options.name };
        roleCache.set(role.id, role);
        guild.roles.createdRoles.push(options);
        return role;
      }
    },
    voiceAdapterCreator: () => {},
    members: { me: {}, fetch: async () => null },
    channels: {
      cache,
      fetch: async (id) => cache.get(id) || null,
      created: [],
      async create(options) {
        if (!canCreate) throw new Error('Missing Permissions');
        const channel = createTextChannel('created-ch', options.name);
        cache.set(channel.id, channel);
        guild.channels.created.push(options);
        return channel;
      }
    }
  };
  return guild;
}

const env = { MUSIC_CHANNEL_NAME: 'voice', MUSIC_ROLE_NAME: 'Voice', YTDLP_PATH: 'yt-dlp', PRIVILEGED_USER_IDS: new Set(['god']) };

function createMember(id, { channelId = 'vc1', manageGuild = false } = {}) {
  return {
    id,
    displayName: `User ${id}`,
    permissions: new PermissionsBitField(manageGuild ? PermissionsBitField.Flags.ManageGuild : 0n),
    voice: { channelId, channel: channelId ? { id: channelId, permissionsFor: () => ({ has: () => true }) } : null }
  };
}

function createInteraction(guild, member, subcommand, options = {}, { channelId = CONTROL_CHANNEL_ID, customId = null, values = [] } = {}) {
  const replies = [];
  return {
    replies,
    guildId: 'g1',
    channelId,
    guild,
    member,
    user: { id: member.id },
    customId,
    values,
    inGuild: () => true,
    isButton: () => Boolean(customId) && customId !== PANEL_IDS.station && customId !== PANEL_IDS.playlist,
    isStringSelectMenu: () => customId === PANEL_IDS.station || customId === PANEL_IDS.playlist,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getUser: (name) => (options[name] ? { id: options[name] } : null),
      get: (name) => (options[name] !== undefined ? { value: options[name] } : null),
      getFocused: () => options.focused ?? ''
    },
    async reply(payload) { replies.push(payload); this.replied = true; },
    async followUp(payload) { replies.push(payload); },
    async deferReply(payload) { this.deferred = true; this.deferPayload = payload; },
    async editReply(payload) { replies.push(payload); },
    async deleteReply() { this.deletedReply = true; },
    async deferUpdate() { this.deferredUpdate = true; },
    async update(payload) { this.updated = payload; },
    lastReply() { return replies[replies.length - 1]; }
  };
}

function createFeature({
  store = createFakeStore(),
  guild = createGuild(),
  spawn = createFakeSpawn(VIDEOS),
  lookup = async () => [{ address: '93.184.216.34', family: 4 }],
  playlists = createPlaylistStore(),
  resumeStore = createResumeStore(),
  cleanupDelayMs = 60_000,
  random = Math.random
} = {}) {
  const voice = createFakeVoice();
  const client = {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', guild]]) },
    channels: { cache: new Map() }
  };
  const voiceSessions = createVoiceSessions({ client, voice });
  const sources = createMusicSources({ spawn });
  const feature = createMusicFeature({ client, env, store, voiceSessions, voice, sources, lookup, playlists, resumeStore, random, panelDelayMs: 0, cleanupDelayMs });
  const musicPlayer = () => voiceSessions.get('g1')?.musicPlayer;
  const channel = guild.channels.cache.get(CONTROL_CHANNEL_ID);
  return { feature, voiceSessions, voice, store, guild, spawn, musicPlayer, playlists, resumeStore, channel };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('music commands only work in the control channel', async () => {
  const { feature, voiceSessions, guild } = createFeature();
  const interaction = createInteraction(guild, createMember('u1'), 'play', { query: 'lofi beats' }, { channelId: 'general' });

  await feature.handleMusicCommand(interaction);

  assert.equal(voiceSessions.get('g1'), null);
  assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(interaction.replies[0].content, new RegExp(`<#${CONTROL_CHANNEL_ID}>`));
});

test('/music play needs the member in a voice channel', async () => {
  const { feature, voiceSessions, guild, spawn } = createFeature();
  const interaction = createInteraction(guild, createMember('u1', { channelId: null }), 'play', { query: 'lofi beats' });

  await feature.handleMusicCommand(interaction);

  assert.equal(voiceSessions.get('g1'), null);
  assert.equal(spawn.calls.length, 0);
  assert.match(interaction.lastReply().content, /Join a voice channel/);
});

test('/music play joins the member channel through the shared voice session and streams via yt-dlp', async () => {
  const { feature, voiceSessions, guild, spawn, musicPlayer } = createFeature();
  const interaction = createInteraction(guild, createMember('owner'), 'play', { query: 'lofi beats' });

  await feature.handleMusicCommand(interaction);

  const session = voiceSessions.get('g1');
  assert.equal(session.channelId, 'vc1');
  assert.equal(session.ownerId, 'owner');
  assert.equal(session.notifyChannelId, CONTROL_CHANNEL_ID);
  assert.equal(interaction.deferPayload.flags, MessageFlags.Ephemeral);
  // Success is announced publicly in the control channel; the ephemeral "thinking" reply is removed.
  assert.equal(interaction.deletedReply, true);
  assert.equal(guild.channels.cache.get(CONTROL_CHANNEL_ID).lastAnnouncement(), '▶️ **User owner** started **Lofi Beats** (3:05)');

  assert.ok(spawn.calls[0].args.includes('ytsearch1:lofi beats'));
  const [, ytdlp, ffmpeg] = spawn.calls;
  assert.equal(ytdlp.command, 'yt-dlp');
  assert.deepEqual(ytdlp.args.slice(-2), ['--', 'https://www.youtube.com/watch?v=a1']);
  assert.ok(ytdlp.args.includes('bestaudio/best[height<=480]/best'));
  assert.equal(ytdlp.options.detached, true);
  // yt-dlp feeds ffmpeg directly; the player gets ffmpeg's PCM.
  assert.equal(ffmpeg.command, 'ffmpeg');
  assert.equal(ffmpeg.options.stdio[0], ytdlp.child.stdout);
  assert.ok(ffmpeg.args.includes('pipe:0'));

  const resource = musicPlayer().resource;
  assert.equal(resource.stream, ffmpeg.child.stdout);
  assert.equal(resource.options.inputType, 'raw');
  assert.equal(resource.options.inlineVolume, true);
  assert.equal(resource.volume.value, 0.5);
  assert.equal(musicPlayer().behaviors.noSubscriber, 'pause');
  assert.equal(session.speechPlayer.played.length, 0);
});

test('the bot refuses to play for a member in another voice channel', async () => {
  const { feature, guild, voiceSessions } = createFeature();
  await feature.handleMusicCommand(createInteraction(guild, createMember('owner'), 'play', { query: 'lofi beats' }));

  const interaction = createInteraction(guild, createMember('other', { channelId: 'vc2' }), 'play', { query: 'second song' });
  await feature.handleMusicCommand(interaction);

  assert.match(interaction.lastReply().content, /already playing in <#vc1>/);
  assert.equal(voiceSessions.get('g1').channelId, 'vc1');
});

test('queued tracks start when the current one ends', async () => {
  const { feature, guild, spawn, musicPlayer } = createFeature();
  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  const second = createInteraction(guild, member, 'play', { query: 'second song' });
  await feature.handleMusicCommand(second);
  assert.equal(guild.channels.cache.get(CONTROL_CHANNEL_ID).lastAnnouncement(), '🎵 **User owner** added **Second Song** (3:20) — position 1');
  assert.equal(musicPlayer().played.length, 1);

  musicPlayer().finish();

  assert.equal(musicPlayer().played.length, 2);
  assert.equal(musicPlayer().resource.options.metadata.title, 'Second Song');
  assert.deepEqual(spawn.calls.at(-2).args.slice(-1), ['https://www.youtube.com/watch?v=b2']);

  const queue = createInteraction(guild, member, 'queue');
  await feature.handleMusicCommand(queue);
  const view = queue.lastReply().embeds[0].toJSON();
  assert.match(view.description, /\*\*Now:\*\* \[Second Song\]/);
  assert.match(view.description, /The queue is empty/);
});

test('live radio keeps streaming without subscribers, tracks pause', async () => {
  const { feature, guild, spawn, musicPlayer } = createFeature();
  const member = createMember('owner');
  const station = BUILT_IN_STATIONS[0];

  const radio = createInteraction(guild, member, 'radio', { station: station.id });
  await feature.handleMusicCommand(radio);
  assert.equal(guild.channels.cache.get(CONTROL_CHANNEL_ID).lastAnnouncement(), `📻 **User owner** switched to **${station.name}**`);
  const ffmpeg = spawn.calls.at(-1);
  assert.equal(ffmpeg.command, 'ffmpeg');
  assert.ok(ffmpeg.args.includes(station.url));
  assert.ok(ffmpeg.args.includes('-reconnect'));
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf('-protocol_whitelist') + 1], 'http,https,tcp,tls');
  assert.ok(ffmpeg.args.indexOf('-protocol_whitelist') < ffmpeg.args.indexOf('-i'));
  assert.equal(musicPlayer().resource.options.inputType, 'raw');
  assert.equal(musicPlayer().behaviors.noSubscriber, 'play');

  // A track replaces the radio right away and switches back to pausing.
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  assert.deepEqual(ffmpeg.child.signals, ['SIGKILL']);
  assert.equal(musicPlayer().behaviors.noSubscriber, 'pause');

  // A live YouTube stream is treated like radio.
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'https://youtu.be/live1' }));
  musicPlayer().finish();
  assert.equal(musicPlayer().resource.options.metadata.isLive, true);
  assert.equal(musicPlayer().behaviors.noSubscriber, 'play');
});

test('/music stop kills the stream process and clears the queue', async () => {
  const { feature, guild, spawn, musicPlayer } = createFeature();
  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'second song' }));
  const streams = spawn.calls.filter((call) => !call.args.includes('--dump-single-json'));
  assert.deepEqual(streams.map((call) => call.command), ['yt-dlp', 'ffmpeg']);

  const stop = createInteraction(guild, member, 'stop');
  await feature.handleMusicCommand(stop);

  assert.match(guild.channels.cache.get(CONTROL_CHANNEL_ID).lastAnnouncement(), /\*\*User owner\*\* stopped playback/);
  for (const stream of streams) assert.deepEqual(stream.child.signals, ['SIGKILL']);
  assert.equal(musicPlayer().status, 'idle');
  assert.equal(musicPlayer().played.length, 1);

  const nowPlaying = createInteraction(guild, member, 'nowplaying');
  await feature.handleMusicCommand(nowPlaying);
  assert.match(nowPlaying.lastReply().content, /Nothing is playing/);
});

test('controls need a listener of the bot channel or a server manager', async () => {
  const { feature, guild, musicPlayer } = createFeature();
  await feature.handleMusicCommand(createInteraction(guild, createMember('owner'), 'play', { query: 'lofi beats' }));

  const outsider = createInteraction(guild, createMember('outsider', { channelId: null }), null, {}, { customId: PANEL_IDS.skip });
  assert.equal(await feature.handlePanelInteraction(outsider), true);
  assert.match(outsider.lastReply().content, /Join <#vc1>/);
  assert.equal(musicPlayer().status, 'playing');

  const manager = createInteraction(guild, createMember('admin', { channelId: null, manageGuild: true }), null, {}, { customId: PANEL_IDS.pause });
  await feature.handlePanelInteraction(manager);
  assert.match(manager.lastReply().content, /Paused/);
  assert.equal(musicPlayer().status, 'paused');

  const volumeUp = createInteraction(guild, createMember('owner'), null, {}, { customId: PANEL_IDS.volumeUp });
  await feature.handlePanelInteraction(volumeUp);
  assert.match(volumeUp.lastReply().content, /60%/);
  assert.equal(musicPlayer().resource.volume.value, 0.6);

  assert.equal(await feature.handlePanelInteraction(createInteraction(guild, createMember('x'), null, {}, { customId: 'other' })), false);
});

test('the station select plays radio and the session end cleans up', async () => {
  const { feature, guild, voiceSessions, spawn } = createFeature();
  const select = createInteraction(guild, createMember('owner'), null, {}, { customId: PANEL_IDS.station, values: [BUILT_IN_STATIONS[1].id] });

  await feature.handlePanelInteraction(select);
  assert.match(guild.channels.cache.get(CONTROL_CHANNEL_ID).lastAnnouncement(), /switched to/);
  assert.equal(select.deletedReply, true);
  const ffmpeg = spawn.calls.at(-1);

  voiceSessions.leave('g1', 'test');
  assert.deepEqual(ffmpeg.child.signals, ['SIGKILL']);

  const nowPlaying = createInteraction(guild, createMember('owner'), 'nowplaying');
  await feature.handleMusicCommand(nowPlaying);
  assert.match(nowPlaying.lastReply().content, /Nothing is playing/);
});

test('yt-dlp lookups reject long videos, non-YouTube links and unavailable videos', async () => {
  const sources = createMusicSources({ spawn: createFakeSpawn(VIDEOS) });

  await assert.rejects(sources.resolveTrack('very long'), /longer than 3 hours/);
  await assert.rejects(sources.resolveTrack('https://example.com/song.mp3'), /Only YouTube links/);
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(sources.resolveTrack('https://youtu.be/missing'), /unavailable/);
  } finally {
    console.error = originalError;
  }
  const live = await sources.resolveTrack('https://youtu.be/live1');
  assert.equal(live.isLive, true);
  assert.equal(live.duration, null);
  assert.equal(live.title, 'Live Radio');
});

test('the control channel is reused, found by name or created, and gets one panel', async () => {
  const existing = createTextChannel('by-name', 'Voice');
  const found = createFeature({ store: createFakeStore({ controlChannelId: 'gone' }), guild: createGuild({ channels: [existing] }) });
  await found.feature.ensureControlChannel(found.guild);
  assert.equal(found.store.guilds.g1.music.controlChannelId, 'by-name');
  assert.equal(existing.sent.length, 1);
  assert.equal(found.store.guilds.g1.music.panelMessageId, 'm1');

  // Second start edits the same panel; a deleted panel is posted again.
  await found.feature.ensureControlChannel(found.guild);
  assert.equal(existing.sent.length, 1);
  assert.equal(existing.edits.length, 1);
  existing.deleteMessage('m1');
  await found.feature.handleMessageDelete({ id: 'm1', guildId: 'g1' });
  await tick();
  assert.equal(existing.sent.length, 2);
  assert.equal(found.store.guilds.g1.music.panelMessageId, 'm2');

  const created = createFeature({ store: createFakeStore({ controlChannelId: null }), guild: createGuild({ channels: [] }) });
  await created.feature.ensureControlChannel(created.guild);
  assert.equal(created.guild.channels.created[0].name, 'voice');
  assert.equal(created.store.guilds.g1.music.controlChannelId, 'created-ch');

  const refused = createFeature({ store: createFakeStore({ controlChannelId: null }), guild: createGuild({ channels: [], canCreate: false }) });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await refused.feature.ensureControlChannel(refused.guild), null);
  } finally {
    console.error = originalError;
  }
});

test('the panel updates after playback changes', async () => {
  const { feature, guild } = createFeature();
  const channel = guild.channels.cache.get(CONTROL_CHANNEL_ID);
  await feature.handleMusicCommand(createInteraction(guild, createMember('owner'), 'play', { query: 'lofi beats' }));
  await tick();

  const embed = channel.sent.at(-1).embeds[0].toJSON();
  const nowPlaying = embed.fields.find((field) => field.name === 'Now playing').value;
  assert.match(nowPlaying, /Lofi Beats/);
  assert.match(nowPlaying, /<@owner>/);
});

test('the panel embed shows playback, queue, volume, station and the command overview', () => {
  const stations = listStations([{ name: 'My Station', url: 'https://example.com/stream' }]);
  const message = buildPanelMessage({
    current: { kind: 'radio', title: 'Lofi (laut.fm)', stationKey: 'lautfm-lofi', isLive: true, requesterId: 'u1' },
    queue: [{ kind: 'track', title: 'Next', url: 'https://www.youtube.com/watch?v=n', duration: 3725 }],
    paused: true,
    volume: 40,
    channelId: 'vc1',
    stations
  });

  const embed = message.embeds[0].toJSON();
  const field = (name) => embed.fields.find((entry) => entry.name.startsWith(name)).value;
  assert.match(embed.description, /<#vc1>/);
  assert.match(field('Now playing'), /Lofi \(laut\.fm\).*🔴 Live/);
  assert.match(field('Now playing'), /Source: Radio/);
  assert.match(field('Now playing'), /<@u1>.*paused/);
  assert.match(field('Queue (1 · 1:02:05)'), /\[Next\].*1:02:05/);
  assert.equal(field('Loop'), 'Off');
  assert.equal(field('Volume'), '40%');
  assert.equal(field('Radio station'), 'Lofi (laut.fm)');
  assert.match(field('Commands'), /\/music play/);
  assert.match(field('Commands'), /\/tts join/);

  const [buttons, extras, select] = message.components.map((row) => row.toJSON().components);
  assert.deepEqual(buttons.map((button) => button.custom_id), [PANEL_IDS.pause, PANEL_IDS.skip, PANEL_IDS.stop, PANEL_IDS.shuffle, PANEL_IDS.loop]);
  assert.deepEqual(extras.map((button) => button.custom_id), [PANEL_IDS.volumeDown, PANEL_IDS.volumeUp, PANEL_IDS.queue]);
  assert.equal(buttons[3].disabled, true, 'one queued track cannot be shuffled');
  assert.equal(buttons[0].label, 'Resume');
  assert.equal(select[0].custom_id, PANEL_IDS.station);
  assert.equal(select[0].options.length, BUILT_IN_STATIONS.length + 1);
  assert.equal(select[0].options.find((option) => option.value === 'lautfm-lofi').default, true);
  assert.equal(select[0].options.at(-1).value, 'custom:my station');

  const idle = buildPanelMessage({ stations });
  assert.match(idle.embeds[0].toJSON().fields[0].value, /Nothing is playing/);
  assert.equal(idle.components[0].toJSON().components[1].disabled, true);
});

test('station autocomplete offers built-in and custom stations', async () => {
  const { feature, guild } = createFeature({ store: createFakeStore({ stations: [{ name: 'Jazz Corner', url: 'https://example.com/jazz' }] }) });
  let choices = null;
  const interaction = createInteraction(guild, createMember('u1'), 'radio', { focused: 'jazz' });
  interaction.respond = async (value) => { choices = value; };

  await feature.handleStationAutocomplete(interaction);

  assert.ok(choices.some((choice) => choice.value === 'custom:jazz corner'));
  assert.ok(choices.some((choice) => choice.value === 'lautfm-loungetunes'));
  assert.ok(choices.every((choice) => /jazz/i.test(choice.name)));
});

test('pause and resume follow what the player really did', async () => {
  const { feature, guild, musicPlayer } = createFeature();
  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  const player = musicPlayer();

  // Auto-paused while TTS speaks: pause() returns false, the wish is applied once it plays again.
  player.setStatus('autopaused');
  const pause = createInteraction(guild, member, 'pause');
  await feature.handleMusicCommand(pause);
  assert.match(pause.lastReply().content, /Paused/);
  assert.equal(player.status, 'autopaused');
  player.setStatus('playing');
  assert.equal(player.status, 'paused');

  const again = createInteraction(guild, member, 'pause');
  await feature.handleMusicCommand(again);
  assert.match(again.lastReply().content, /Already paused/);

  const resume = createInteraction(guild, member, 'resume');
  await feature.handleMusicCommand(resume);
  assert.match(resume.lastReply().content, /Resumed/);
  assert.equal(player.status, 'playing');

  // Resume while auto-paused: unpause() fails, and the track must not be re-paused when it continues.
  await feature.handleMusicCommand(createInteraction(guild, member, 'pause'));
  assert.equal(player.status, 'paused');
  player.setStatus('autopaused');
  await feature.handleMusicCommand(createInteraction(guild, member, 'resume'));
  player.setStatus('playing');
  assert.equal(player.status, 'playing');

  // A new track starts unpaused even if the old one was paused.
  await feature.handleMusicCommand(createInteraction(guild, member, 'pause'));
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'second song' }));
  await feature.handleMusicCommand(createInteraction(guild, member, 'skip'));
  assert.equal(player.status, 'playing');
});

test('after the first setup a cleared or deleted control channel is not created again', async () => {
  const kept = createFeature({ store: createFakeStore({ controlChannelId: CONTROL_CHANNEL_ID }) });
  await kept.feature.ensureControlChannel(kept.guild);
  assert.equal(kept.store.guilds.g1.music.autoSetupDone, true);
  assert.equal(kept.store.guilds.g1.music.controlChannelId, CONTROL_CHANNEL_ID);

  const first = createFeature({ store: createFakeStore({ controlChannelId: null }), guild: createGuild({ channels: [] }) });
  await first.feature.ensureControlChannel(first.guild);
  assert.equal(first.store.guilds.g1.music.autoSetupDone, true);
  assert.equal(first.guild.channels.created.length, 1);

  // The admin cleared the channel in /setup (or deleted it); a restart leaves it unset.
  first.store.setGuildConfig('g1', { music: { ...first.store.getGuildConfig('g1').music, controlChannelId: null, panelMessageId: null } });
  first.guild.channels.cache.delete('created-ch');
  assert.equal(await first.feature.ensureControlChannel(first.guild), null);
  assert.equal(first.guild.channels.created.length, 1);
  assert.equal(first.store.guilds.g1.music.controlChannelId, null);

  const deleted = createFeature({ store: createFakeStore({ controlChannelId: 'gone', autoSetupDone: true }), guild: createGuild({ channels: [createTextChannel('by-name')] }) });
  assert.equal(await deleted.feature.ensureControlChannel(deleted.guild), null);
  assert.equal(deleted.guild.channels.created.length, 0);
  assert.equal(deleted.store.guilds.g1.music.controlChannelId, 'gone');

  const command = createInteraction(first.guild, createMember('u1'), 'play', { query: 'lofi beats' });
  await first.feature.handleMusicCommand(command);
  assert.match(command.lastReply().content, /not set up/);
});

test('the panel is only posted again when Discord says it is gone', async () => {
  const { feature, guild, store } = createFeature();
  const channel = guild.channels.cache.get(CONTROL_CHANNEL_ID);
  await feature.refreshPanel('g1');
  assert.equal(store.guilds.g1.music.panelMessageId, 'm1');

  const originalError = console.error;
  console.error = () => {};
  try {
    channel.fetchError = Object.assign(new Error('Service unavailable'), { status: 503 });
    await feature.refreshPanel('g1');
  } finally {
    console.error = originalError;
  }
  assert.equal(channel.sent.length, 1);
  assert.equal(store.guilds.g1.music.panelMessageId, 'm1');

  channel.fetchError = null;
  channel.deleteMessage('m1');
  await feature.refreshPanel('g1');
  assert.equal(channel.sent.length, 2);
  assert.equal(store.guilds.g1.music.panelMessageId, 'm2');
});

test('a panel posted while /setup moved the control channel is not saved', async () => {
  const other = createTextChannel('other-ch');
  const { feature, guild, store } = createFeature({ guild: createGuild({ channels: [createTextChannel(CONTROL_CHANNEL_ID), other] }) });
  const channel = guild.channels.cache.get(CONTROL_CHANNEL_ID);
  const send = channel.send.bind(channel);
  channel.send = async (payload) => {
    const message = await send(payload);
    store.setGuildConfig('g1', { music: { ...store.getGuildConfig('g1').music, controlChannelId: 'other-ch', panelMessageId: null } });
    return message;
  };

  await feature.refreshPanel('g1');
  assert.deepEqual(channel.deleted, ['m1']);
  await tick();
  assert.equal(other.sent.length, 1);
  assert.equal(store.guilds.g1.music.panelMessageId, 'm1');
  assert.equal(store.guilds.g1.music.controlChannelId, 'other-ch');
});

test('yt-dlp lookups run one per server and never walk playlists or channels', async () => {
  const spawn = createFakeSpawn(VIDEOS);
  const { feature, guild } = createFeature({ spawn });
  const first = createInteraction(guild, createMember('owner'), 'play', { query: 'lofi beats' });
  const second = createInteraction(guild, createMember('owner'), 'play', { query: 'second song' });

  await Promise.all([feature.handleMusicCommand(first), feature.handleMusicCommand(second)]);
  assert.equal(first.deletedReply, true);
  assert.match(second.lastReply().content, /busy/);
  const lookups = spawn.calls.filter((call) => call.args.includes('--dump-single-json'));
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].args[lookups[0].args.indexOf('--playlist-items') + 1], '1');

  const after = createInteraction(guild, createMember('owner'), 'play', { query: 'second song' });
  await feature.handleMusicCommand(after);
  assert.equal(after.deletedReply, true);

  const sources = createMusicSources({ spawn: createFakeSpawn(VIDEOS) });
  for (const url of ['https://www.youtube.com/@LofiGirl', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/channel/UC123/videos', 'https://youtu.be/']) {
    await assert.rejects(sources.resolveTrack(url), /single YouTube video/, url);
  }
});

test('the global yt-dlp lookup cap is shared by all servers', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const sources = { resolveTrack: async () => { await pending; return { kind: 'track', title: 'T', url: 'https://www.youtube.com/watch?v=t', duration: 10 }; }, spawnTrack: () => ({ stdout: new PassThrough(), kill() {} }) };
  const voice = createFakeVoice();
  const guilds = new Map();
  const store = { getGuildConfig: () => ({ music: { controlChannelId: CONTROL_CHANNEL_ID, panelMessageId: null, stations: [], volume: 50 } }), setGuildConfig() {} };
  const client = { user: { id: 'bot' }, guilds: { cache: guilds }, channels: { cache: new Map() } };
  const feature = createMusicFeature({ client, env, store, voiceSessions: createVoiceSessions({ client, voice }), voice, sources, panelDelayMs: 0 });
  const interactions = ['g1', 'g2', 'g3', 'g4'].map((guildId) => {
    const guild = { ...createGuild(), id: guildId };
    const interaction = createInteraction(guild, createMember('owner'), 'play', { query: 'x' });
    interaction.guildId = guildId;
    return interaction;
  });

  const runs = interactions.map((interaction) => feature.handleMusicCommand(interaction));
  await tick();
  assert.match(interactions[3].lastReply().content, /busy/);
  release();
  await Promise.all(runs);
  assert.ok(interactions.slice(0, 3).every((interaction) => interaction.deletedReply === true));
});

test('custom stations on private hosts or names that resolve to private addresses are refused', async () => {
  const { checkStationUrl, assertPublicStationUrl } = require('../src/features/music/urlSafety');
  for (const url of [
    'http://localhost:5000/stream', 'http://tts:5000/', 'http://api.localhost/', 'http://127.0.0.1/', 'http://10.1.2.3/',
    'http://172.20.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'http://100.64.0.1/', 'http://[::1]/',
    'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0.0.0.0/', 'ftp://radio.example.com/'
  ]) {
    assert.ok(checkStationUrl(url), url);
  }
  for (const url of ['https://stream.laut.fm/lofi', 'http://8.8.8.8/stream', 'http://172.32.0.1/', 'http://[2001:db8::1]/']) {
    assert.equal(checkStationUrl(url), null, url);
  }

  const lookup = async (host) => (host === 'evil.example.com'
    ? [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(assertPublicStationUrl('https://evil.example.com/stream', { lookup }), /private/);
  assert.equal(await assertPublicStationUrl('https://radio.example.com/stream', { lookup }), 'https://radio.example.com/stream');
  await assert.rejects(assertPublicStationUrl('https://missing.example.com/', { lookup: async () => { throw new Error('ENOTFOUND'); } }), /could not be found/);

  // At play time the same checks run with DNS, so a stored station cannot reach the bot's network.
  const stations = [{ name: 'Rebind', url: 'https://evil.example.com/stream' }, { name: 'Old', url: 'http://tts:5000/' }, { name: 'Fine', url: 'https://radio.example.com/stream' }];
  const { feature, guild, voiceSessions, spawn } = createFeature({ store: createFakeStore({ stations }), lookup });
  for (const name of ['rebind', 'old']) {
    const refused = createInteraction(guild, createMember('owner'), 'radio', { station: `custom:${name}` });
    await feature.handleMusicCommand(refused);
    assert.match(refused.lastReply().content, /Can't play/);
  }
  assert.equal(voiceSessions.get('g1'), null);
  assert.equal(spawn.calls.length, 0);

  const fine = createInteraction(guild, createMember('owner'), 'radio', { station: 'custom:fine' });
  await feature.handleMusicCommand(fine);
  assert.equal(fine.deletedReply, true);
  assert.ok(spawn.calls.at(-1).args.includes('https://radio.example.com/stream'));
});

test('without a voice session only server managers may change the stored volume', async () => {
  const { feature, guild, store } = createFeature();
  const member = createInteraction(guild, createMember('u1'), 'volume', { level: 80 });
  await feature.handleMusicCommand(member);
  assert.match(member.lastReply().content, /Only server managers/);
  assert.equal(store.guilds.g1.music.volume, 50);

  const button = createInteraction(guild, createMember('u1'), null, {}, { customId: PANEL_IDS.volumeUp });
  await feature.handlePanelInteraction(button);
  assert.match(button.lastReply().content, /Only server managers/);

  for (const manager of [createMember('admin', { channelId: null, manageGuild: true }), createMember('god', { channelId: null })]) {
    const interaction = createInteraction(guild, manager, 'volume', { level: 80 });
    await feature.handleMusicCommand(interaction);
    assert.match(interaction.lastReply().content, /80%/);
  }
  assert.equal(store.guilds.g1.music.volume, 80);
});

test('the music channel is only visible to the Voice role, which is created once', async () => {
  const created = createFeature({ store: createFakeStore({ controlChannelId: null }), guild: createGuild({ channels: [] }) });
  await created.feature.ensureControlChannel(created.guild);

  assert.equal(created.guild.roles.createdRoles[0].name, 'Voice');
  const overwrites = created.guild.channels.created[0].permissionOverwrites;
  assert.deepEqual(overwrites.find((entry) => entry.id === 'g1').deny, ['ViewChannel']);
  assert.ok(overwrites.find((entry) => entry.id === 'voice-role').allow.includes('ViewChannel'));
  assert.ok(overwrites.find((entry) => entry.id === 'bot').allow.includes('ViewChannel'));
  assert.equal(created.store.guilds.g1.music.roleId, 'voice-role');

  // An existing bot channel is limited once; an admin-picked channel with another name never is.
  const existing = createTextChannel('old-voice', 'voice');
  const migrated = createFeature({ store: createFakeStore({ controlChannelId: 'old-voice', autoSetupDone: true }), guild: createGuild({ channels: [existing] }) });
  await migrated.feature.ensureControlChannel(migrated.guild);
  assert.equal(existing.overwrites.get('g1').ViewChannel, false);
  assert.equal(existing.overwrites.get('voice-role').ViewChannel, true);
  assert.equal(migrated.store.guilds.g1.music.accessSetupDone, true);

  const general = createTextChannel('general', 'general');
  const picked = createFeature({ store: createFakeStore({ controlChannelId: 'general', autoSetupDone: true }), guild: createGuild({ channels: [general] }) });
  await picked.feature.ensureControlChannel(picked.guild);
  assert.equal(general.overwrites.size, 0);
});

// --- queue, loop, announcements, cleanup, continue, playlists -----------------------------------

const MORE_VIDEOS = {
  ...VIDEOS,
  'ytsearch1:third song': { entries: [{ id: 'd4', title: 'Third Song', webpage_url: 'https://www.youtube.com/watch?v=d4', duration: 100 }] },
  'ytsearch1:fourth song': { entries: [{ id: 'e5', title: 'Fourth Song', webpage_url: 'https://www.youtube.com/watch?v=e5', duration: 100 }] },
  'ytsearch1:sneaky': { entries: [{ id: 'f6', title: '**Bold** @everyone <@123> _x_', webpage_url: 'https://www.youtube.com/watch?v=f6', duration: 60 }] },
  'https://www.youtube.com/playlist?list=PLchill': {
    title: 'Chill Mix',
    entries: [
      { id: 'aaaaaa1', title: 'One', duration: 100 },
      { id: 'bbbbbb2', title: '[Deleted video]' },
      { id: 'cccccc3', title: 'Three', duration: 200 },
      { id: 'dddddd4', title: 'Way too long', duration: 4 * 60 * 60 }
    ]
  }
};

function titles(items) {
  return items.map((item) => item.title);
}

async function playAll(feature, guild, member, queries) {
  for (const query of queries) await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query }));
}

function currentTitle(musicPlayer) {
  return musicPlayer().resource?.options.metadata.title || null;
}

function latestPanel(channel) {
  return channel.edits.at(-1) || channel.sent.filter((payload) => payload.embeds).at(-1);
}

function componentsOf(payload) {
  return payload.components.flatMap((row) => row.toJSON().components);
}

test('playnext, shuffle, remove, move and clear change only the queue', async () => {
  // A random() that always picks index 0 turns [a,b,c] into [b,c,a].
  const { feature, guild, channel, musicPlayer } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS), random: () => 0 });
  const member = createMember('owner');
  await playAll(feature, guild, member, ['lofi beats', 'second song', 'third song']);
  await feature.handleMusicCommand(createInteraction(guild, member, 'playnext', { query: 'fourth song' }));
  assert.equal(channel.lastAnnouncement(), '⏫ **User owner** added **Fourth Song** (1:40) — up next');

  const queueText = async () => {
    const view = createInteraction(guild, member, 'queue');
    await feature.handleMusicCommand(view);
    return view.lastReply().embeds[0].toJSON().description;
  };
  assert.match(await queueText(), /`1\.` \[Fourth Song\][\s\S]*`2\.` \[Second Song\][\s\S]*`3\.` \[Third Song\]/);

  await feature.handleMusicCommand(createInteraction(guild, member, 'shuffle'));
  assert.equal(channel.lastAnnouncement(), '🔀 **User owner** shuffled the queue (3 tracks)');
  assert.equal(currentTitle(musicPlayer), 'Lofi Beats');
  assert.match(await queueText(), /`1\.` \[Second Song\][\s\S]*`2\.` \[Third Song\][\s\S]*`3\.` \[Fourth Song\]/);

  const badRemove = createInteraction(guild, member, 'remove', { position: 4 });
  await feature.handleMusicCommand(badRemove);
  assert.match(badRemove.lastReply().content, /no track at position 4; the queue has 3 tracks/);
  const badMove = createInteraction(guild, member, 'move', { from: 1, to: 9 });
  await feature.handleMusicCommand(badMove);
  assert.match(badMove.lastReply().content, /no track at position 9/);

  const move = createInteraction(guild, member, 'move', { from: 3, to: 1 });
  await feature.handleMusicCommand(move);
  assert.match(move.lastReply().content, /Moved \[Fourth Song\].*position 1/);
  const remove = createInteraction(guild, member, 'remove', { position: 2 });
  await feature.handleMusicCommand(remove);
  assert.match(remove.lastReply().content, /Removed \[Second Song\]/);
  assert.match(await queueText(), /`1\.` \[Fourth Song\][\s\S]*`2\.` \[Third Song\]/);

  // Members outside the voice channel may not change the queue.
  const outsider = createInteraction(guild, createMember('x', { channelId: null }), 'clear');
  await feature.handleMusicCommand(outsider);
  assert.match(outsider.lastReply().content, /Join <#vc1>/);

  await feature.handleMusicCommand(createInteraction(guild, member, 'clear'));
  assert.equal(channel.lastAnnouncement(), '🧹 **User owner** cleared the queue (2 tracks)');
  assert.match(await queueText(), /The queue is empty/);
  assert.equal(currentTitle(musicPlayer), 'Lofi Beats');
});

test('loop modes: track repeats, queue cycles, failed tracks are not retried forever', async () => {
  const { feature, guild, channel, musicPlayer } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS) });
  const member = createMember('owner');
  await playAll(feature, guild, member, ['lofi beats', 'second song']);

  await feature.handleMusicCommand(createInteraction(guild, member, 'loop', { mode: 'track' }));
  assert.equal(channel.lastAnnouncement(), '🔂 **User owner** set loop to **this track**');
  musicPlayer().finish();
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Lofi Beats');

  // A track that dies right away (deleted video, network) moves on instead of looping.
  musicPlayer().resource.playbackDuration = 200;
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Second Song');
  // Skip in track mode goes to the next track too.
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'third song' }));
  await feature.handleMusicCommand(createInteraction(guild, member, 'skip'));
  assert.equal(currentTitle(musicPlayer), 'Third Song');
  assert.match(channel.lastAnnouncement(), /skipped \*\*Second Song\*\* · now playing \*\*Third Song\*\*/);

  // Queue loop: finished tracks go to the end.
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'fourth song' }));
  await feature.handleMusicCommand(createInteraction(guild, member, 'loop', { mode: 'queue' }));
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Fourth Song');
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Third Song');
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Fourth Song');
  // A failing track drops out of the loop, so a queue of broken videos ends.
  musicPlayer().resource.playbackDuration = 0;
  musicPlayer().finish();
  assert.equal(currentTitle(musicPlayer), 'Third Song');
  musicPlayer().resource.playbackDuration = 0;
  musicPlayer().finish();
  assert.equal(musicPlayer().status, 'idle');

  // The panel button cycles the mode (queue → off) and answers with the public message only.
  await playAll(feature, guild, member, ['lofi beats']);
  const button = createInteraction(guild, member, null, {}, { customId: PANEL_IDS.loop });
  await feature.handlePanelInteraction(button);
  assert.equal(button.deferredUpdate, true);
  assert.match(channel.lastAnnouncement(), /turned looping \*\*off\*\*/);
});

test('announcements escape markdown and never mention anyone', async () => {
  const { feature, guild, channel } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS) });
  const member = { ...createMember('owner'), displayName: '*Max*' };
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'sneaky' }));

  const payload = channel.sent.find((entry) => typeof entry.content === 'string' && !entry.embeds);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.content, '▶️ **\\*Max\\*** started **\\*\\*Bold\\*\\* @everyone \\<@123\\> \\_x\\_** (1:00)');
  assert.doesNotMatch(payload.content, /https?:/, 'no link, so Discord shows no video embed');

  // Errors stay ephemeral and are not announced.
  const before = channel.announcements().length;
  const refused = createInteraction(guild, createMember('other', { channelId: 'vc2' }), 'play', { query: 'second song' });
  await feature.handleMusicCommand(refused);
  assert.equal(refused.deferPayload.flags, MessageFlags.Ephemeral);
  assert.match(refused.lastReply().content, /already playing/);
  assert.equal(channel.announcements().length, before);
});

test('/music play keeps the 50 track limit, playlists fill the queue up to 100', async () => {
  const { feature, guild, channel, playlists, musicPlayer } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS) });
  const member = createMember('owner');
  const actor = { id: 'owner', isManager: false };
  const tracks = Array.from({ length: 120 }, (_, index) => ({ kind: 'track', title: `Song ${index + 1}`, url: `https://www.youtube.com/watch?v=s${index + 1}`, duration: 60 }));
  playlists.create('g1', actor, 'Big', tracks.slice(0, 60));
  playlists.create('g1', actor, 'Bigger', tracks.slice(60));

  await feature.handlePlaylistCommand(createInteraction(guild, member, 'play', { name: 'Big' }));
  assert.equal(channel.lastAnnouncement(), '📃 **User owner** queued playlist **Big** (60 tracks)');
  assert.equal(currentTitle(musicPlayer), 'Song 1');

  const full = createInteraction(guild, member, 'play', { query: 'second song' });
  await feature.handleMusicCommand(full);
  assert.match(full.lastReply().content, /queue is full \(50 tracks\)/);

  await feature.handlePlaylistCommand(createInteraction(guild, member, 'play', { name: 'bigger' }));
  assert.equal(channel.lastAnnouncement(), '📃 **User owner** queued playlist **Bigger** (41 tracks) — the queue is limited to 100 tracks, 19 not queued');
  const again = createInteraction(guild, member, 'play', { name: 'Big' });
  await feature.handlePlaylistCommand(again);
  assert.match(again.lastReply().content, /queue is full \(100 tracks\)/);
});

test('the queue view has pages of 10 with working page buttons', async () => {
  const { feature, guild, playlists } = createFeature();
  const member = createMember('owner');
  const tracks = Array.from({ length: 25 }, (_, index) => ({ kind: 'track', title: `Song ${index + 1}`, url: `https://www.youtube.com/watch?v=q${index + 1}`, duration: 60 }));
  playlists.create('g1', { id: 'owner' }, 'Mix', tracks);
  await feature.handlePlaylistCommand(createInteraction(guild, member, 'play', { name: 'Mix' }));

  const queue = createInteraction(guild, member, 'queue');
  await feature.handleMusicCommand(queue);
  const first = queue.lastReply();
  const embed = first.embeds[0].toJSON();
  assert.match(embed.title, /Queue \(24\)/);
  assert.match(embed.description, /`10\.` \[Song 11\]/);
  assert.doesNotMatch(embed.description, /`11\./);
  assert.match(embed.footer.text, /Page 1\/3 · 24 tracks · total 24:00 · Loop: off/);
  const [previous, next] = first.components[0].toJSON().components;
  assert.equal(previous.disabled, true);

  const page = createInteraction(guild, member, null, {}, { customId: next.custom_id });
  assert.equal(await feature.handlePanelInteraction(page), true);
  assert.match(page.updated.embeds[0].toJSON().description, /`11\.` \[Song 12\]/);
  assert.match(page.updated.embeds[0].toJSON().footer.text, /Page 2\/3/);
});

test('when playback ends the control channel is cleaned up so only the panel is left', async () => {
  const { feature, guild, channel, store } = createFeature({ cleanupDelayMs: 5 });
  await feature.refreshPanel('g1');
  const panelId = store.guilds.g1.music.panelMessageId;
  const chat = channel.addMessage({ content: 'nice song' });
  const old = channel.addMessage({ content: 'from last month', ageMs: 20 * 24 * 60 * 60 * 1000 });

  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  await tick();
  assert.ok(channel.messageIds().includes(chat.id), 'nothing is deleted while music plays');

  await feature.handleMusicCommand(createInteraction(guild, member, 'stop'));
  await tick();
  await tick();
  assert.deepEqual(channel.messageIds(), [panelId]);
  assert.ok(channel.bulkDeletes.some((ids) => ids.includes(chat.id)), 'recent messages go in one bulk delete');
  assert.ok(!channel.bulkDeletes.some((ids) => ids.includes(old.id)), 'messages older than 14 days are deleted one by one');
  assert.ok(channel.deleted.includes(old.id));
});

test('new playback cancels a pending cleanup, idle chat is cleaned up later', async () => {
  const { feature, guild, channel } = createFeature({ cleanupDelayMs: 30 });
  await feature.refreshPanel('g1');
  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'lofi beats' }));
  await feature.handleMusicCommand(createInteraction(guild, member, 'stop'));
  const chat = channel.addMessage({ content: 'one more' });
  await feature.handleMusicCommand(createInteraction(guild, member, 'play', { query: 'second song' }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(channel.messageIds().includes(chat.id));

  await feature.handleMusicCommand(createInteraction(guild, member, 'stop'));
  const idleChat = channel.addMessage({ content: 'bye' });
  await feature.handleMessageCreate({ id: idleChat.id, guildId: 'g1', channelId: CONTROL_CHANNEL_ID });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(!channel.messageIds().includes(idleChat.id));
  assert.ok(!channel.messageIds().includes(chat.id));
});

test('startup cleans the channel and re-posts the panel when it cannot be on top', async () => {
  const { feature, guild, channel, store } = createFeature();
  // An older message that cannot be deleted, then the panel, then chat and a newer undeletable one.
  const stuckOld = channel.addMessage({ content: 'rules', undeletable: true });
  await feature.refreshPanel('g1');
  const firstPanel = store.guilds.g1.music.panelMessageId;
  channel.addMessage({ content: 'chat' });
  const stuckNew = channel.addMessage({ content: 'stuck', undeletable: true });

  await feature.ensureControlChannel(guild);
  const panelId = store.guilds.g1.music.panelMessageId;
  assert.notEqual(panelId, firstPanel);
  assert.deepEqual(channel.messageIds().sort(), [stuckOld.id, stuckNew.id, panelId].sort());

  // Now the panel is the newest message: the next cleanup leaves it alone.
  const sentBefore = channel.sent.length;
  await feature.ensureControlChannel(guild);
  assert.equal(store.guilds.g1.music.panelMessageId, panelId);
  assert.equal(channel.sent.length, sentBefore);
});

test('cleanup never touches other channels', async () => {
  const other = createTextChannel('general', 'general');
  const { feature, guild } = createFeature({ guild: createGuild({ channels: [createTextChannel(CONTROL_CHANNEL_ID), other] }), cleanupDelayMs: 0 });
  const message = other.addMessage({ content: 'hello' });
  await feature.handleMessageCreate({ id: message.id, guildId: 'g1', channelId: 'general' });
  await feature.ensureControlChannel(guild);
  await tick();
  assert.deepEqual(other.messageIds(), [message.id]);
  assert.equal(other.bulkDeletes.length, 0);
});

test('the panel stays within Discord limits with many stations and playlists', () => {
  const stations = listStations(Array.from({ length: 30 }, (_, index) => ({ name: `Station ${index} ${'x'.repeat(120)}`, url: `https://example.com/${index}` })));
  const long = 'L'.repeat(200);
  const queue = Array.from({ length: 100 }, (_, index) => ({ kind: 'track', title: `${long}${index}`, url: `https://www.youtube.com/watch?v=${index}`, duration: 300 }));
  const playlistEntries = Array.from({ length: 40 }, (_, index) => ({ id: `p${index}`, name: 'P'.repeat(50), ownerId: 'u', tracks: queue }));
  for (const state of [
    { current: { ...queue[0], requesterId: 'u', author: long, thumbnail: 'https://i.ytimg.com/x.jpg' }, queue, stations, playlists: playlistEntries, loop: 'queue' },
    { stations, playlists: playlistEntries, resumable: 101 }
  ]) {
    const message = buildPanelMessage(state);
    const embed = message.embeds[0].toJSON();
    assert.ok(embed.fields.length <= 25);
    for (const field of embed.fields) {
      assert.ok(field.value.length <= 1024, field.name);
      assert.ok(field.name.length <= 256, field.name);
    }
    const total = embed.title.length + embed.description.length + embed.footer.text.length
      + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    assert.ok(total <= 6000, `embed has ${total} characters`);
    assert.ok(message.components.length <= 5);
    for (const row of message.components.map((entry) => entry.toJSON().components)) {
      assert.ok(row.length <= 5);
      for (const component of row) {
        if (component.options) {
          assert.ok(component.options.length <= 25);
          assert.ok(component.options.every((option) => option.label.length <= 100 && (option.description || '').length <= 100));
        }
        if (component.label) assert.ok(component.label.length <= 80);
      }
    }
  }
  const ids = componentsOf(buildPanelMessage({ stations, playlists: playlistEntries, resumable: 3 })).map((component) => component.custom_id);
  assert.ok(ids.includes(PANEL_IDS.resume));
  assert.ok(ids.includes(PANEL_IDS.playlist));
  assert.ok(!componentsOf(buildPanelMessage({ current: queue[0], resumable: 3 })).some((component) => component.custom_id === PANEL_IDS.resume));
});

test('stop and an owner leaving keep a snapshot that /music continue restores at the saved position', async () => {
  const { feature, guild, channel, voiceSessions, spawn, musicPlayer, resumeStore } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS) });
  const owner = createMember('owner');
  await playAll(feature, guild, owner, ['lofi beats', 'second song', 'third song']);
  await feature.handleMusicCommand(createInteraction(guild, owner, 'loop', { mode: 'queue' }));

  // The owner leaves: the session ends and the snapshot remembers the track 65 s in.
  await voiceSessions.handleVoiceStateUpdate(
    { guild: { id: 'g1' }, id: 'owner', channelId: 'vc1', channel: { members: new Collection() } },
    { guild: { id: 'g1' }, id: 'owner', channelId: null }
  );
  assert.equal(voiceSessions.get('g1'), null);
  const snapshot = resumeStore.get('g1');
  assert.equal(snapshot.current.title, 'Lofi Beats');
  assert.equal(snapshot.position, 65);
  assert.deepEqual(titles(snapshot.queue), ['Second Song', 'Third Song']);
  assert.equal(snapshot.loop, 'queue');
  assert.match(snapshot.reason, /owner left/);

  const other = createMember('max', { channelId: 'vc2' });
  await feature.handleMusicCommand(createInteraction(guild, other, 'continue'));
  assert.equal(voiceSessions.get('g1').channelId, 'vc2');
  assert.equal(currentTitle(musicPlayer), 'Lofi Beats');
  const ffmpeg = spawn.calls.at(-1);
  assert.equal(ffmpeg.command, 'ffmpeg');
  const seek = ffmpeg.args.indexOf('-ss');
  assert.deepEqual(ffmpeg.args.slice(seek, seek + 2), ['-ss', '65']);
  assert.ok(seek < ffmpeg.args.indexOf('-i'));
  assert.equal(channel.lastAnnouncement(), '⏯️ **User max** continued the last session (3 tracks) with **Lofi Beats** at 1:05');
  assert.equal(resumeStore.get('g1'), null, 'a continued snapshot is used up');

  // Continue while playing is refused; stop keeps a new snapshot (offset + time played).
  const twice = createInteraction(guild, other, 'continue');
  await feature.handleMusicCommand(twice);
  assert.match(twice.lastReply().content, /already playing/);
  await feature.handleMusicCommand(createInteraction(guild, other, 'stop'));
  assert.equal(resumeStore.get('g1').position, 130);
  assert.equal(resumeStore.get('g1').savedBy, 'max');
});

test('continue restarts radio live and snapshots expire after 24 hours', async () => {
  let clock = 1_000_000;
  const resumeStore = createResumeStore({ now: () => clock });
  const { feature, guild, voiceSessions, spawn, channel } = createFeature({ resumeStore });
  const member = createMember('owner');
  await feature.handleMusicCommand(createInteraction(guild, member, 'radio', { station: BUILT_IN_STATIONS[0].id }));
  voiceSessions.leave('g1', 'bot was disconnected');
  assert.equal(resumeStore.get('g1').position, 0);

  await feature.refreshPanel('g1');
  assert.ok(componentsOf(latestPanel(channel)).some((component) => component.custom_id === PANEL_IDS.resume));

  const button = createInteraction(guild, member, null, {}, { customId: PANEL_IDS.resume });
  await feature.handlePanelInteraction(button);
  const ffmpeg = spawn.calls.at(-1);
  assert.ok(ffmpeg.args.includes(BUILT_IN_STATIONS[0].url));
  assert.ok(!ffmpeg.args.includes('-ss'));
  assert.match(channel.lastAnnouncement(), /continued the last session \(1 track\)/);

  // The bot leaves again: a new snapshot, which expires after 24 hours.
  voiceSessions.leave('g1', 'test');
  assert.equal(resumeStore.get('g1').current.title, BUILT_IN_STATIONS[0].name);
  clock += 25 * 60 * 60 * 1000;
  assert.equal(resumeStore.get('g1'), null);
  const late = createInteraction(guild, member, 'continue');
  await feature.handleMusicCommand(late);
  assert.match(late.lastReply().content, /no stopped session/);

  // A queue that simply finished leaves nothing to continue.
  const fresh = createFeature();
  await fresh.feature.handleMusicCommand(createInteraction(fresh.guild, member, 'play', { query: 'lofi beats' }));
  fresh.musicPlayer().finish();
  assert.equal(fresh.resumeStore.get('g1'), null);
});

test('/playlist play, save, add and import through the feature', async () => {
  const { feature, guild, channel, playlists, spawn, musicPlayer } = createFeature({ spawn: createFakeSpawn(MORE_VIDEOS), random: () => 0 });
  const owner = createMember('owner');
  const max = createMember('max');

  await feature.handlePlaylistCommand(createInteraction(guild, owner, 'create', { name: 'Chill' }));
  // add without query needs something playing; with a query it looks the video up.
  const empty = createInteraction(guild, owner, 'add', { name: 'Chill' });
  await feature.handlePlaylistCommand(empty);
  assert.match(empty.lastReply().content, /Nothing is playing/);
  const add = createInteraction(guild, owner, 'add', { name: 'chill', query: 'lofi beats' });
  await feature.handlePlaylistCommand(add);
  assert.match(add.lastReply().content, /Added \[Lofi Beats\].*\*\*Chill\*\* \(1 track\)/);
  assert.equal(channel.announcements().length, 0, 'changes to a private playlist are not announced');

  // Import: one flat yt-dlp lookup; placeholders and too long videos are skipped.
  const importing = createInteraction(guild, owner, 'import', { name: 'Chill', url: 'https://www.youtube.com/watch?v=x&list=PLchill' });
  await feature.handlePlaylistCommand(importing);
  const lookup = spawn.calls.at(-1);
  assert.ok(lookup.args.includes('--flat-playlist'));
  assert.ok(!lookup.args.includes('--no-playlist'));
  assert.equal(lookup.args[lookup.args.indexOf('--playlist-items') + 1], '1:100');
  assert.equal(lookup.args.at(-1), 'https://www.youtube.com/playlist?list=PLchill');
  assert.match(importing.lastReply().content, /Imported \*\*Chill Mix\*\* .*2 tracks \(2 unavailable skipped\)/);
  assert.deepEqual(titles(playlists.resolve('g1', { id: 'owner' }, 'Chill').tracks), ['Lofi Beats', 'One', 'Three']);

  // Max cannot see the private playlist; once public he can play it shuffled.
  const hidden = createInteraction(guild, max, 'play', { name: 'Chill', user: 'owner' });
  await feature.handlePlaylistCommand(hidden);
  assert.match(hidden.lastReply().content, /no public playlist called \*\*Chill\*\*/);
  await feature.handlePlaylistCommand(createInteraction(guild, owner, 'visibility', { name: 'Chill', mode: 'public' }));
  await feature.handlePlaylistCommand(createInteraction(guild, max, 'play', { name: 'Chill', user: 'owner', shuffle: true }));
  assert.equal(channel.lastAnnouncement(), '📃 **User max** queued playlist **Chill** by <@owner> (3 tracks, shuffled)');
  assert.deepEqual(channel.sent.at(-1).allowedMentions, { parse: [] });
  assert.equal(currentTitle(musicPlayer), 'One');

  // Max may not change it, but can save the queue as his own playlist.
  const chillId = playlists.resolve('g1', { id: 'owner' }, 'Chill').id;
  const denied = createInteraction(guild, max, 'add', { name: `#${chillId}` });
  await feature.handlePlaylistCommand(denied);
  assert.match(denied.lastReply().content, /Only <@owner> or a server manager/);
  const save = createInteraction(guild, max, 'save', { name: 'Chill' });
  await feature.handlePlaylistCommand(save);
  assert.match(save.lastReply().content, /Saved your playlist \*\*Chill\*\* with the queue \(3 tracks\)/);
  assert.deepEqual(titles(playlists.resolve('g1', { id: 'max' }, 'Chill').tracks), ['One', 'Three', 'Lofi Beats']);

  // Adding the current track to a public playlist is announced.
  await feature.handlePlaylistCommand(createInteraction(guild, owner, 'create', { name: 'Faves' }));
  await feature.handlePlaylistCommand(createInteraction(guild, owner, 'visibility', { name: 'Faves', mode: 'public' }));
  await feature.handlePlaylistCommand(createInteraction(guild, owner, 'add', { name: 'Faves' }));
  assert.equal(channel.lastAnnouncement(), '➕ **User owner** added **One** to playlist **Faves** (1 track)');

  // The panel select offers the public playlists only, most recently used first.
  await feature.refreshPanel('g1');
  const select = componentsOf(latestPanel(channel)).find((component) => component.custom_id === PANEL_IDS.playlist);
  assert.deepEqual(select.options.map((option) => option.label), ['Chill', 'Faves']);
  assert.match(select.options[0].description, /3 tracks · 8:05/);

  const pick = createInteraction(guild, max, null, {}, { customId: PANEL_IDS.playlist, values: [select.options[1].value] });
  await feature.handlePanelInteraction(pick);
  assert.match(channel.lastAnnouncement(), /queued playlist \*\*Faves\*\* by <@owner> \(1 track\)/);
});

test('playlist autocomplete lists own playlists first, then public ones by owner', async () => {
  const { feature, guild, playlists } = createFeature();
  guild.members.cache = new Collection([['owner', { displayName: 'Owner' }]]);
  playlists.create('g1', { id: 'owner' }, 'Chill Public', [], { visibility: 'public' });
  playlists.create('g1', { id: 'owner' }, 'Chill Secret');
  playlists.create('g1', { id: 'max' }, 'My Chill');
  const suggest = async (subcommand, focused, extra = {}) => {
    let choices = null;
    const interaction = createInteraction(guild, createMember('max'), subcommand, { focused, ...extra });
    interaction.respond = async (value) => { choices = value; };
    await feature.handlePlaylistAutocomplete(interaction);
    return choices;
  };

  const play = await suggest('play', 'chill');
  assert.deepEqual(play.map((choice) => choice.name), ['My Chill', 'Chill Public — by Owner']);
  assert.equal(play[0].value, 'My Chill');
  assert.match(play[1].value, /^#/);
  assert.deepEqual((await suggest('delete', '')).map((choice) => choice.name), ['My Chill']);
  assert.deepEqual((await suggest('show', '', { user: 'owner' })).map((choice) => choice.name), ['Chill Public — by Owner']);

  // The "#id" value of a suggestion resolves to that playlist.
  const show = createInteraction(guild, createMember('max'), 'show', { name: play[1].value });
  await feature.handlePlaylistCommand(show);
  assert.match(show.lastReply().embeds[0].toJSON().title, /Chill Public/);
});
