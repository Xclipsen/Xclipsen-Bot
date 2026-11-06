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
      player.pause = () => { player.status = 'paused'; return true; };
      player.unpause = () => { player.status = 'playing'; return true; };
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
  const channel = {
    id,
    name,
    type: ChannelType.GuildText,
    messages: {
      fetch: async (messageId) => {
        if (!messages.has(messageId)) throw new Error('Unknown Message');
        return messages.get(messageId);
      }
    },
    sent: [],
    edits: [],
    async send(payload) {
      const message = { id: `m${nextId++}`, payload, edit: async (next) => { message.payload = next; channel.edits.push(next); } };
      messages.set(message.id, message);
      channel.sent.push(payload);
      return message;
    },
    deleteMessage: (messageId) => messages.delete(messageId)
  };
  return channel;
}

function createGuild({ channels = [createTextChannel(CONTROL_CHANNEL_ID)], canCreate = true } = {}) {
  const cache = new Collection(channels.map((channel) => [channel.id, channel]));
  const guild = {
    id: 'g1',
    name: 'Guild',
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

const env = { MUSIC_CHANNEL_NAME: 'voice', YTDLP_PATH: 'yt-dlp', PRIVILEGED_USER_IDS: new Set(['god']) };

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
    isButton: () => Boolean(customId) && customId !== PANEL_IDS.station,
    isStringSelectMenu: () => customId === PANEL_IDS.station,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getFocused: () => options.focused ?? ''
    },
    async reply(payload) { replies.push(payload); this.replied = true; },
    async followUp(payload) { replies.push(payload); },
    async deferReply(payload) { this.deferred = true; this.deferPayload = payload; },
    async editReply(payload) { replies.push(payload); },
    lastReply() { return replies[replies.length - 1]; }
  };
}

function createFeature({ store = createFakeStore(), guild = createGuild(), spawn = createFakeSpawn(VIDEOS) } = {}) {
  const voice = createFakeVoice();
  const client = {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', guild]]) },
    channels: { cache: new Map() }
  };
  const voiceSessions = createVoiceSessions({ client, voice });
  const sources = createMusicSources({ spawn });
  const feature = createMusicFeature({ client, env, store, voiceSessions, voice, sources, panelDelayMs: 0 });
  const musicPlayer = () => voiceSessions.get('g1')?.musicPlayer;
  return { feature, voiceSessions, voice, store, guild, spawn, musicPlayer };
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
  assert.match(interaction.lastReply().content, /Now playing \[Lofi Beats\]/);

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
  assert.match(second.lastReply().content, /Queued at position 1/);
  assert.equal(musicPlayer().played.length, 1);

  musicPlayer().finish();

  assert.equal(musicPlayer().played.length, 2);
  assert.equal(musicPlayer().resource.options.metadata.title, 'Second Song');
  assert.deepEqual(spawn.calls.at(-2).args.slice(-1), ['https://www.youtube.com/watch?v=b2']);

  const queue = createInteraction(guild, member, 'queue');
  await feature.handleMusicCommand(queue);
  assert.match(queue.lastReply().content, /Second Song/);
  assert.match(queue.lastReply().content, /The queue is empty/);
});

test('live radio keeps streaming without subscribers, tracks pause', async () => {
  const { feature, guild, spawn, musicPlayer } = createFeature();
  const member = createMember('owner');
  const station = BUILT_IN_STATIONS[0];

  const radio = createInteraction(guild, member, 'radio', { station: station.id });
  await feature.handleMusicCommand(radio);
  assert.match(radio.lastReply().content, new RegExp(`Tuned in to \\*\\*${station.name.replace(/[()]/g, '\\$&')}`));
  const ffmpeg = spawn.calls.at(-1);
  assert.equal(ffmpeg.command, 'ffmpeg');
  assert.ok(ffmpeg.args.includes(station.url));
  assert.ok(ffmpeg.args.includes('-reconnect'));
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

  assert.match(stop.lastReply().content, /Stopped playback/);
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
  assert.match(select.lastReply().content, /Tuned in/);
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
  assert.match(field('Queue (1)'), /\[Next\].*1:02:05/);
  assert.equal(field('Volume'), '40%');
  assert.equal(field('Radio station'), 'Lofi (laut.fm)');
  assert.match(field('Commands'), /\/music play/);
  assert.match(field('Commands'), /\/tts join/);

  const [buttons, select] = message.components.map((row) => row.toJSON().components);
  assert.deepEqual(buttons.map((button) => button.custom_id), [PANEL_IDS.pause, PANEL_IDS.skip, PANEL_IDS.stop, PANEL_IDS.volumeDown, PANEL_IDS.volumeUp]);
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
