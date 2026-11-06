const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

process.env.DISCORD_TOKEN ||= 'test-token';

const { MessageFlags, PermissionsBitField } = require('discord.js');
const { createTtsFeature } = require('../src/features/tts');
const { toSpeakerName, toSpeechText } = require('../src/features/tts/speechText');

test('speech text removes Discord markup and resolves mentions', () => {
  const text = toSpeechText(
    '**Hey** <@123> schau mal in <#456> 🔥 https://example.com/x <:pog:999> ||geheim|| @everyone `code`',
    {
      resolveUser: (id) => (id === '123' ? 'Max' : null),
      resolveChannel: (id) => (id === '456' ? 'dungeons' : null)
    }
  );

  assert.equal(text, 'Hey Max schau mal in dungeons Link Spoiler alle code');
});

test('speech text truncates long messages at a word boundary', () => {
  const text = toSpeechText('wort '.repeat(100), { maxLength: 50 });
  assert.ok(text.endsWith('und so weiter'));
  assert.ok(text.length < 70);
});

test('speaker names drop emojis and separators', () => {
  assert.equal(toSpeakerName('xX_Pro_Xx 🔥'), 'xX Pro Xx');
  assert.equal(toSpeakerName('🔥'), '');
});

function createFakeVoice() {
  const played = [];
  const voice = {
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed', Signalling: 'signalling', Connecting: 'connecting' },
    AudioPlayerStatus: { Idle: 'idle' },
    StreamType: { Arbitrary: 'arbitrary' },
    joinVoiceChannel(options) {
      const connection = new EventEmitter();
      connection.options = options;
      connection.state = { status: 'ready' };
      connection.subscribe = () => {};
      connection.destroy = () => {
        connection.state = { status: 'destroyed' };
        connection.emit('destroyed');
      };
      voice.lastConnection = connection;
      return connection;
    },
    createAudioPlayer() {
      const player = new EventEmitter();
      player.play = (resource) => played.push(resource);
      player.stop = () => {};
      voice.lastPlayer = player;
      return player;
    },
    createAudioResource: (stream) => ({ stream }),
    entersState: async () => {},
    played
  };
  return voice;
}

function createFakeStore(initial = {}) {
  const guilds = { g1: { tts: { roleId: 'tts-role', voice: null, ...initial } } };
  return {
    getGuildConfig: (guildId) => ({ tts: { roleId: null, voice: null, followUserIds: [], userVoices: {}, ...guilds[guildId]?.tts } }),
    setGuildConfig: (guildId, partial) => { guilds[guildId] = { ...guilds[guildId], ...partial }; },
    guilds
  };
}

const env = {
  TTS_ROLE_NAME: 'TTS',
  TTS_MAX_QUEUE: 10,
  TTS_MAX_CHARS: 300,
  PRIVILEGED_USER_IDS: new Set(['god'])
};

function createMember(id, { roles = [], channelId = 'vc1', manageGuild = false } = {}) {
  return {
    id,
    displayName: `User ${id}`,
    guild: { id: 'g1' },
    roles: { cache: new Map(roles.map((role) => [role, {}])) },
    permissions: new PermissionsBitField(manageGuild ? PermissionsBitField.Flags.ManageGuild : 0n),
    voice: { channelId, channel: channelId ? { id: channelId, permissionsFor: () => ({ has: () => true }) } : null }
  };
}

function createInteraction(member, subcommand, options = {}) {
  const replies = [];
  return {
    replies,
    guildId: 'g1',
    channelId: 'text1',
    member,
    user: { id: member.id },
    guild: {
      id: 'g1',
      voiceAdapterCreator: () => {},
      members: { me: {}, cache: new Map() },
      channels: { cache: new Map() },
      roles: { cache: new Map() }
    },
    inGuild: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => options[name] ?? null,
      getUser: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null
    },
    async reply(payload) { replies.push(payload); this.replied = true; },
    async followUp(payload) { replies.push(payload); },
    async deferReply() { this.deferred = true; },
    async editReply(payload) { replies.push(payload); }
  };
}

function createFeature({ store = createFakeStore(), voice = createFakeVoice(), synthesized = [] } = {}) {
  const sent = [];
  const client = {
    user: { id: 'bot' },
    users: { cache: new Map() },
    channels: { cache: new Map([['text1', { send: async (payload) => sent.push(payload) }]]) }
  };
  const ttsClient = {
    synthesize: async (text, voiceId) => {
      synthesized.push({ text, voiceId });
      return Buffer.from('wav');
    },
    listVoices: async () => [{ id: 'thorsten', label: 'Thorsten' }]
  };
  const feature = createTtsFeature({ client, env, store, voice, ttsClient });
  return { feature, voice, store, synthesized, sent };
}

const accessControl = { ensureSetupAccess: async () => true };

test('/tts join is refused without the TTS role', async () => {
  const { feature } = createFeature();
  const interaction = createInteraction(createMember('u1'), 'join');

  await feature.handleTtsCommand(interaction, accessControl);

  assert.equal(feature.getSession('g1'), null);
  assert.match(interaction.replies[0].content, /<@&tts-role>/);
  assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
});

test('/tts join needs the member in a voice channel', async () => {
  const { feature } = createFeature();
  const interaction = createInteraction(createMember('u1', { roles: ['tts-role'], channelId: null }), 'join');

  await feature.handleTtsCommand(interaction, accessControl);

  assert.equal(feature.getSession('g1'), null);
  assert.match(interaction.replies[0].content, /Join a voice channel/);
});

test('messages are only read from role members in the bot voice channel', async () => {
  const { feature, synthesized, voice } = createFeature();
  const owner = createMember('owner', { roles: ['tts-role'] });
  await feature.handleTtsCommand(createInteraction(owner, 'join'), accessControl);
  assert.equal(feature.getSession('g1').channelId, 'vc1');
  assert.equal(voice.lastConnection.options.selfDeaf, true);

  const message = (member, content, channelId = 'text1') => ({
    inGuild: () => true,
    author: { bot: false },
    system: false,
    guildId: 'g1',
    channelId,
    member,
    content,
    guild: { members: { cache: new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } },
    react: async () => {}
  });

  await feature.handleMessage(message(owner, 'Hallo zusammen'));
  await feature.handleMessage(message(owner, 'Noch was'));
  await feature.handleMessage(message(createMember('other', { roles: ['tts-role'], channelId: 'vc2' }), 'nicht im Channel'));
  await feature.handleMessage(message(createMember('norole'), 'ohne Rolle'));
  await feature.handleMessage(message(owner, 'falscher Kanal', 'text2'));
  await feature.handleMessage(message(createMember('vcchat', { roles: ['tts-role'] }), 'aus dem Voice-Chat', 'vc1'));

  assert.deepEqual(synthesized.map((entry) => entry.text), [
    'User owner sagt: Hallo zusammen',
    'Noch was',
    'User vcchat sagt: aus dem Voice-Chat'
  ]);
});

test('/tts say is refused when the member is not in the bot voice channel', async () => {
  const { feature, synthesized } = createFeature();
  await feature.handleTtsCommand(createInteraction(createMember('owner', { roles: ['tts-role'] }), 'join'), accessControl);

  const interaction = createInteraction(createMember('away', { roles: ['tts-role'], channelId: null }), 'say', { text: 'Hallo' });
  await feature.handleTtsCommand(interaction, accessControl);

  assert.equal(synthesized.length, 0);
  assert.match(interaction.replies[0].content, /You need to be in <#vc1>/);
});

test('the bot leaves when the member who ran /tts join leaves the channel', async () => {
  const { feature, voice, sent } = createFeature();
  await feature.handleTtsCommand(createInteraction(createMember('owner', { roles: ['tts-role'] }), 'join'), accessControl);

  // Someone else leaving does not matter.
  await feature.handleVoiceStateUpdate({ id: 'guest', channelId: 'vc1', guild: { id: 'g1' } }, { id: 'guest', channelId: null });
  assert.notEqual(feature.getSession('g1'), null);

  await feature.handleVoiceStateUpdate({ id: 'owner', channelId: 'vc1', guild: { id: 'g1' } }, { id: 'owner', channelId: 'vc2' });
  assert.equal(feature.getSession('g1'), null);
  assert.equal(voice.lastConnection.state.status, 'destroyed');
  assert.match(sent[0].content, /left the voice channel/);
});

test('ensureRole creates the TTS role once and stores its id', async () => {
  const store = createFakeStore({ roleId: null });
  const { feature } = createFeature({ store });
  const created = [];
  const roles = new Map();
  roles.find = (predicate) => [...roles.values()].find(predicate);
  const guild = {
    id: 'g1',
    name: 'Test',
    roles: {
      cache: roles,
      fetch: async (id) => roles.get(id) || null,
      create: async (options) => {
        const role = { id: 'new-role', name: options.name };
        created.push(options);
        roles.set(role.id, role);
        return role;
      }
    }
  };

  await feature.ensureRole(guild);
  await feature.ensureRole(guild);

  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'TTS');
  assert.deepEqual(created[0].permissions, []);
  assert.equal(store.guilds.g1.tts.roleId, 'new-role');
});

test('/tts voice stores a known voice for the server', async () => {
  const store = createFakeStore();
  const { feature, synthesized } = createFeature({ store });
  const interaction = createInteraction(createMember('admin', { manageGuild: true }), 'voice', { voice: 'thorsten' });

  await feature.handleTtsCommand(interaction, accessControl);
  assert.equal(store.guilds.g1.tts.voice, 'thorsten');

  const unknown = createInteraction(createMember('admin', { manageGuild: true }), 'voice', { voice: 'nope' });
  await feature.handleTtsCommand(unknown, accessControl);
  assert.equal(store.guilds.g1.tts.voice, 'thorsten');
  assert.match(unknown.replies[0].content, /Unknown voice/);
  assert.equal(synthesized.length, 0);
});

test('/tts whisper uses the whisper voice and always announces the verb', async () => {
  const { feature, synthesized } = createFeature();
  const owner = createMember('owner', { roles: ['tts-role'] });
  await feature.handleTtsCommand(createInteraction(owner, 'join'), accessControl);

  await feature.handleTtsCommand(createInteraction(owner, 'say', { text: 'Hallo' }), accessControl);
  await feature.handleTtsCommand(createInteraction(owner, 'whisper', { text: 'Psst' }), accessControl);
  await feature.handleTtsCommand(createInteraction(owner, 'say', { text: 'Normal', voice: 'thorsten_sleepy' }), accessControl);

  assert.deepEqual(synthesized, [
    { text: 'User owner sagt: Hallo', voiceId: null },
    { text: 'User owner flüstert: Psst', voiceId: 'thorsten_whisper' },
    { text: 'Normal', voiceId: 'thorsten_sleepy' }
  ]);
});

test('/tts follow is for privileged users and reads the followed user from any channel', async () => {
  const store = createFakeStore();
  const { feature, synthesized } = createFeature({ store });
  const followed = createMember('followed', { channelId: null });

  const admin = createInteraction(createMember('admin', { manageGuild: true }), 'follow', { user: { id: 'followed' } });
  await feature.handleTtsCommand(admin, accessControl);
  assert.match(admin.replies[0].content, /Only the bot owners/);
  assert.equal(store.guilds.g1.tts.followUserIds, undefined);

  await feature.handleTtsCommand(createInteraction(createMember('god'), 'follow', { user: { id: 'followed' } }), accessControl);
  assert.deepEqual(store.guilds.g1.tts.followUserIds, ['followed']);

  await feature.handleTtsCommand(createInteraction(createMember('owner', { roles: ['tts-role'] }), 'join'), accessControl);
  const message = {
    inGuild: () => true,
    author: { bot: false },
    system: false,
    guildId: 'g1',
    channelId: 'somewhere-else',
    member: followed,
    content: 'Ich bin gar nicht im Voice',
    guild: { members: { cache: new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } },
    react: async () => {}
  };
  await feature.handleMessage(message);
  assert.deepEqual(synthesized.map((entry) => entry.text), ['User followed sagt: Ich bin gar nicht im Voice']);

  await feature.handleTtsCommand(createInteraction(createMember('god'), 'follow', { user: { id: 'followed' } }), accessControl);
  assert.deepEqual(store.guilds.g1.tts.followUserIds, []);
  await feature.handleMessage(message);
  assert.equal(synthesized.length, 1);
});

test('admins without the TTS role are not read, and own voices are used', async () => {
  const store = createFakeStore();
  const { feature, synthesized } = createFeature({ store });
  const owner = createMember('owner', { roles: ['tts-role'] });
  await feature.handleTtsCommand(createInteraction(owner, 'join'), accessControl);

  const message = (member, content) => ({
    inGuild: () => true,
    author: { bot: false },
    system: false,
    guildId: 'g1',
    channelId: 'text1',
    member,
    content,
    guild: { members: { cache: new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } },
    react: async () => {}
  });

  await feature.handleMessage(message(createMember('admin', { manageGuild: true }), 'Ich bin Admin ohne Rolle'));
  assert.equal(synthesized.length, 0);

  // Others' voices need bot access; your own voice does not.
  const foreign = createInteraction(owner, 'uservoice', { user: { id: 'someone' }, voice: 'thorsten' });
  await feature.handleTtsCommand(foreign, { ...accessControl, hasAccess: () => false });
  assert.match(foreign.replies[0].content, /only change your own voice/);

  await feature.handleTtsCommand(createInteraction(owner, 'uservoice', { user: { id: 'owner' }, voice: 'thorsten' }), { ...accessControl, hasAccess: () => false });
  assert.deepEqual(store.guilds.g1.tts.userVoices, { owner: 'thorsten' });

  await feature.handleMessage(message(owner, 'Mit eigener Stimme'));
  assert.deepEqual(synthesized, [{ text: 'User owner sagt: Mit eigener Stimme', voiceId: 'thorsten' }]);

  await feature.handleTtsCommand(createInteraction(owner, 'uservoice', { user: { id: 'owner' } }), accessControl);
  assert.deepEqual(store.guilds.g1.tts.userVoices, {});
});
