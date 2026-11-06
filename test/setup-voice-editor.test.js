const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField, ChannelType } = require('discord.js');
const { createAccessControl } = require('../src/features/accessControl');
const { createVoiceEditor, parseStationInput, clampVolume, stationKey, MAX_STATIONS } = require('../src/features/setupHub/voiceEditor');
const { createSetupHubRenderers } = require('../src/features/setupHub/renderers');
const { interactionIds } = require('../src/config/interactionIds');
const { createTempStore } = require('./helpers');
const GUILD = '1257088955711619163';
const ADMIN = '123456789012345678';
const OWNER = '123456789012345679';
const MEMBER = '223456789012345678';
const ROLE = '234567890123456789';
const CHANNEL = '345678901234567890';
const OLD_CHANNEL = '345678901234567891';
const VOICE_CHANNEL = '345678901234567892';
const BOT = '999999999999999990';
const VOICES = [{ id: 'thorsten', label: 'Thorsten (Piper, German)' }, { id: 'jenny', label: 'Jenny (Piper, English)' }];

function fixture(t, { voices = VOICES } = {}) {
  const { store } = createTempStore(t, 'setup-voice-');
  const privilegedUserIds = new Set([OWNER]);
  const accessControl = createAccessControl(privilegedUserIds, store);
  const ttsClient = { listVoices: async () => { if (voices instanceof Error) throw voices; return voices; } };
  const editor = createVoiceEditor({ store, accessControl, privilegedUserIds, ttsClient });
  const deleted = [];
  const permissions = new PermissionsBitField(Object.values(PermissionsBitField.Flags));
  const channel = (id, type = ChannelType.GuildText) => ({ id, type, permissionsFor: () => permissions,
    messages: { fetch: async messageId => ({ id: messageId, author: { id: BOT }, delete: async () => deleted.push(messageId) }) } });
  const channels = { [CHANNEL]: channel(CHANNEL), [OLD_CHANNEL]: channel(OLD_CHANNEL), [VOICE_CHANNEL]: channel(VOICE_CHANNEL, ChannelType.GuildVoice) };
  const guild = { id: GUILD, name: 'Testing', client: { user: { id: BOT } }, members: { me: { permissions }, fetch: async id => (id === MEMBER || id === ADMIN || id === OWNER ? { id } : null) },
    roles: { fetch: async id => (id === ROLE ? { id, managed: false } : null) }, channels: { fetch: async id => channels[id] || null } };
  function interaction(customId, { values = [], user = ADMIN, fields = {}, manageGuild = true } = {}) {
    const messages = [];
    return { customId, values, user: { id: user }, guildId: GUILD, guild, member: { roles: [] },
      memberPermissions: new PermissionsBitField(manageGuild ? [PermissionsBitField.Flags.ManageGuild] : []), inGuild: () => true,
      fields: { getTextInputValue: name => fields[name] ?? '' }, messages, modals: [],
      reply: async p => messages.push(p), update: async p => messages.push(p), editReply: async p => messages.push(p), deferUpdate: async () => {},
      showModal: async function (modal) { this.modals.push(modal); } };
  }
  async function run(customId, options) {
    const i = interaction(customId, options);
    assert.equal(await editor.handle(i), true);
    return i;
  }
  const view = i => ({ embed: i.messages.at(-1).embeds[0].toJSON(), rows: i.messages.at(-1).components.map(r => r.toJSON()) });
  return { store, editor, guild, deleted, interaction, run, view, config: () => store.getGuildConfig(GUILD) };
}

test('the voice section renders TTS and music summaries with a setting menu and nav row', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { tts: { ...f.config().tts, roleId: ROLE, voice: 'thorsten' }, music: { ...f.config().music, controlChannelId: CHANNEL, volume: 40 } });
  const { embed, rows } = f.view(await f.run('admin:open:voice:role'));
  assert.equal(embed.title, 'Admin • Voice (TTS & Music)');
  assert.match(embed.fields.find(x => x.name === 'TTS').value, new RegExp(`<@&${ROLE}>[\\s\\S]*\`thorsten\``));
  assert.match(embed.fields.find(x => x.name === 'Music').value, new RegExp(`<#${CHANNEL}>[\\s\\S]*40%[\\s\\S]*0/25`));
  assert.deepEqual(rows[0].components[0].options.map(o => o.value), ['role', 'voice', 'uservoices', 'follow', 'channel', 'musicrole', 'volume', 'stations']);
  assert.equal(rows[1].components[0].type, 6, 'role select');
  assert.deepEqual(rows[1].components[0].default_values, [{ id: ROLE, type: 'role' }]);
  assert.equal(rows.at(-1).components[0].custom_id, interactionIds.SETUP_VIEW_HOME_ID);
  for (const field of ['voice', 'uservoices', 'follow', 'channel', 'volume', 'stations']) {
    const { rows: fieldRows } = f.view(await f.run(`admin:field:voice:role`, { values: [field] }));
    assert.ok(fieldRows.length <= 5 && fieldRows.every(r => r.components.length <= 5));
    assert.equal(fieldRows[0].components[0].options.find(o => o.default).value, field);
  }
  const channelView = f.view(await f.run('admin:open:voice:channel'));
  assert.deepEqual(channelView.rows[1].components[0].channel_types, [ChannelType.GuildText]);
});

test('the overview links to the voice section and summarizes it', async t => {
  const f = fixture(t);
  const renderers = createSetupHubRenderers({ store: f.store, interactionIds });
  const embed = renderers.createSetupHubEmbed(f.guild).toJSON();
  assert.match(embed.fields.find(x => x.name === 'Voice').value, /Volume: 50%/);
  const rows = renderers.createSetupComponents().map(r => r.toJSON());
  assert.ok(rows.every(r => r.components.length <= 5));
  assert.equal(rows.flatMap(r => r.components).find(c => c.custom_id === 'admin:open:voice:role').label, 'Voice');
});

test('other sections are left to the generic editor and access is checked', async t => {
  const f = fixture(t);
  assert.equal(await f.editor.handle(f.interaction('admin:open:weather:channel')), false);
  assert.equal(await f.editor.handle(f.interaction('setup-view-home')), false);
  const denied = f.interaction('admin:setvolume:voice:volume', { values: ['90'], manageGuild: false });
  assert.equal(await f.editor.handle(denied), true);
  assert.match(denied.messages[0].content, /Bot Access/);
  assert.equal(f.config().music.volume, 50);
});

test('setting the server voice lists service voices and stores a known one', async t => {
  const f = fixture(t);
  const { rows } = f.view(await f.run('admin:open:voice:voice'));
  assert.deepEqual(rows[1].components[0].options.map(o => o.value), ['__default__', 'thorsten', 'jenny']);
  await f.run('admin:setvoice:voice:voice', { values: ['jenny'] });
  assert.equal(f.config().tts.voice, 'jenny');
  const unknown = await f.run('admin:setvoice:voice:voice', { values: ['nobody'] });
  assert.match(f.view(unknown).embed.description, /Could not finish: Unknown voice/);
  assert.equal(f.config().tts.voice, 'jenny');
  await f.run('admin:setvoice:voice:voice', { values: ['__default__'] });
  assert.equal(f.config().tts.voice, null);
});

test('a TTS service outage shows a disabled voice menu instead of failing', async t => {
  const f = fixture(t, { voices: new Error('offline') });
  f.store.setGuildConfig(GUILD, { tts: { ...f.config().tts, voice: 'thorsten', userVoices: { [MEMBER]: 'jenny' } } });
  const { embed, rows } = f.view(await f.run('admin:open:voice:voice'));
  assert.equal(rows[1].components[0].disabled, true);
  assert.match(embed.fields.at(-1).value, /did not answer/);
  // Resetting a personal voice still works while the service is down.
  const picked = f.view(await f.run('admin:pickuser:voice:uservoices', { values: [MEMBER] }));
  assert.deepEqual(picked.rows[2].components[0].options.map(o => o.value), ['__server__']);
  await f.run(`admin:uservoice:voice:uservoices:${MEMBER}`, { values: ['__server__'] });
  assert.deepEqual(f.config().tts.userVoices, {});
  const unconfigured = createVoiceEditor({ store: f.store, accessControl: { ensureSetupAccess: async () => true }, env: {} });
  const view = await unconfigured.render(f.guild, 'voice');
  assert.match(view.embeds[0].toJSON().fields.at(-1).value, /not configured/);
});

test('per-user voices are set for a picked member and reset to the server voice', async t => {
  const f = fixture(t);
  const picked = f.view(await f.run('admin:pickuser:voice:uservoices', { values: [MEMBER] }));
  assert.equal(picked.rows[1].components[0].type, 5, 'user select');
  const voiceMenu = picked.rows[2].components[0];
  assert.equal(voiceMenu.custom_id, `admin:uservoice:voice:uservoices:${MEMBER}`);
  assert.deepEqual(voiceMenu.options.map(o => o.value), ['__server__', 'thorsten', 'jenny']);
  const set = await f.run(voiceMenu.custom_id, { values: ['thorsten'] });
  assert.deepEqual(f.config().tts.userVoices, { [MEMBER]: 'thorsten' });
  assert.match(f.view(set).embed.fields.at(-1).value, new RegExp(`<@${MEMBER}> → \`thorsten\``));
  assert.equal(f.view(set).rows[2].components[0].options.find(o => o.default).value, 'thorsten');
  await f.run(voiceMenu.custom_id, { values: ['__server__'] });
  assert.deepEqual(f.config().tts.userVoices, {});
  const stranger = await f.run('admin:pickuser:voice:uservoices', { values: ['323456789012345678'] });
  assert.match(f.view(stranger).embed.description, /member of this server/);
  await f.run('admin:uservoice:voice:uservoices:abc', { values: ['thorsten'] });
  assert.deepEqual(f.config().tts.userVoices, {});
});

test('only privileged bot users can change the follow list; other admins see it read-only', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { tts: { ...f.config().tts, followUserIds: [ADMIN] } });
  const admin = f.view(await f.run('admin:open:voice:follow'));
  assert.equal(admin.rows.length, 2, 'setting menu and nav row only');
  assert.match(admin.embed.fields.at(-1).value, new RegExp(`<@${ADMIN}>[\\s\\S]*Read-only`));
  const refused = await f.run('admin:save:voice:follow', { values: [MEMBER] });
  assert.match(f.view(refused).embed.description, /Only the bot owners/);
  await f.run('admin:removeitems:voice:follow', { values: [ADMIN] });
  assert.deepEqual(f.config().tts.followUserIds, [ADMIN]);

  const owner = f.view(await f.run('admin:open:voice:follow', { user: OWNER, manageGuild: false }));
  assert.equal(owner.rows[1].components[0].custom_id, 'admin:save:voice:follow');
  assert.doesNotMatch(owner.embed.fields.at(-1).value, /Read-only/);
  await f.run('admin:save:voice:follow', { values: [MEMBER], user: OWNER, manageGuild: false });
  assert.deepEqual(f.config().tts.followUserIds, [ADMIN, MEMBER]);
  const removeMode = f.view(await f.run('admin:removemode:voice:follow', { user: OWNER }));
  assert.equal(removeMode.rows[1].components[0].custom_id, 'admin:removeitems:voice:follow');
  await f.run('admin:removeitems:voice:follow', { values: [ADMIN], user: OWNER });
  assert.deepEqual(f.config().tts.followUserIds, [MEMBER]);
});

test('TTS role and music control channel are validated and saved without losing other settings', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { tts: { ...f.config().tts, voice: 'jenny' }, music: { ...f.config().music, controlChannelId: OLD_CHANNEL, panelMessageId: '456789012345678901', volume: 70 } });
  await f.run('admin:save:voice:role', { values: [ROLE] });
  assert.equal(f.config().tts.roleId, ROLE);
  assert.equal(f.config().tts.voice, 'jenny');
  const voiceChannel = await f.run('admin:save:voice:channel', { values: [VOICE_CHANNEL] });
  assert.match(f.view(voiceChannel).embed.description, /text channel/);
  await f.run('admin:save:voice:channel', { values: [CHANNEL] });
  assert.deepEqual(f.deleted, ['456789012345678901'], 'the old panel is removed');
  const { music } = f.config();
  assert.deepEqual({ controlChannelId: music.controlChannelId, panelMessageId: music.panelMessageId, volume: music.volume }, { controlChannelId: CHANNEL, panelMessageId: null, volume: 70 });
  await f.run('admin:save:voice:role', { values: [] });
  assert.equal(f.config().tts.roleId, null);
});

test('volume is clamped to 0–100 for buttons and the select', async t => {
  const f = fixture(t);
  assert.equal(clampVolume(-5), 0);
  assert.equal(clampVolume(150), 100);
  assert.equal(clampVolume('abc'), 0);
  await f.run('admin:setvolume:voice:volume', { values: ['100'] });
  const up = await f.run('admin:volup:voice:volume');
  assert.equal(f.config().music.volume, 100);
  assert.equal(f.view(up).rows[2].components[1].disabled, true);
  await f.run('admin:setvolume:voice:volume', { values: ['5'] });
  await f.run('admin:voldown:voice:volume');
  assert.equal(f.config().music.volume, 0);
  await f.run('admin:setvolume:voice:volume', { values: ['999'] });
  assert.equal(f.config().music.volume, 100);
  await f.run('admin:voldown:voice:volume');
  assert.equal(f.config().music.volume, 90);
});

test('stations are added through a validated modal', async t => {
  const f = fixture(t);
  const open = await f.run('admin:addstation:voice:stations');
  const modal = open.modals[0].toJSON();
  assert.equal(modal.custom_id, 'admin:savestation:voice:stations');
  assert.deepEqual(modal.components.map(r => r.components[0].custom_id), ['name', 'url']);
  await f.run('admin:savestation:voice:stations', { fields: { name: '  Lofi   Radio ', url: 'https://stream.example.com/lofi.mp3' } });
  assert.deepEqual(f.config().music.stations, [{ name: 'Lofi Radio', url: 'https://stream.example.com/lofi.mp3' }]);
  for (const [url, pattern] of [['ftp://example.com/a', /http/], ['not a url', /http/], ['javascript:alert(1)', /http/]]) {
    const bad = await f.run('admin:savestation:voice:stations', { fields: { name: 'Bad', url } });
    assert.match(f.view(bad).embed.description, pattern);
  }
  const duplicate = await f.run('admin:savestation:voice:stations', { fields: { name: 'lofi radio', url: 'http://other.example.com' } });
  assert.match(f.view(duplicate).embed.description, /already exists/);
  assert.equal(f.config().music.stations.length, 1);
  assert.throws(() => parseStationInput('', 'https://a.example'), /name/);
  assert.throws(() => parseStationInput('x'.repeat(51), 'https://a.example'), /name/);
});

test('stations on local or private hosts are refused', async t => {
  const f = fixture(t);
  for (const [url, pattern] of [['http://localhost:5000/', /localhost/], ['http://tts:5000/speak', /public host/], ['http://127.0.0.1/', /private/],
    ['http://192.168.0.10/stream', /private/], ['http://169.254.169.254/latest/meta-data', /private/], ['http://[::1]:8080/', /private/], ['http://[fd12::5]/', /private/]]) {
    const bad = await f.run('admin:savestation:voice:stations', { fields: { name: 'Bad', url } });
    assert.match(f.view(bad).embed.description, pattern, url);
  }
  assert.deepEqual(f.config().music.stations, []);
  assert.deepEqual(parseStationInput('Public', 'http://8.8.8.8/stream'), { name: 'Public', url: 'http://8.8.8.8/stream' });
});

test('stations can be removed and are capped at 25', async t => {
  const f = fixture(t);
  const stations = Array.from({ length: MAX_STATIONS }, (_, i) => ({ name: `Station ${i}`, url: `https://radio${i}.example.com/stream` }));
  f.store.setGuildConfig(GUILD, { music: { ...f.config().music, stations } });
  const full = f.view(await f.run('admin:open:voice:stations'));
  assert.equal(full.rows[1].components[0].options.length, 25);
  assert.equal(full.rows[2].components[0].disabled, true);
  const blocked = await f.run('admin:addstation:voice:stations');
  assert.equal(blocked.modals.length, 0);
  assert.match(f.view(blocked).embed.description, /At most 25/);
  const overflow = await f.run('admin:savestation:voice:stations', { fields: { name: 'New', url: 'https://new.example.com' } });
  assert.match(f.view(overflow).embed.description, /At most 25/);
  await f.run('admin:removestations:voice:stations', { values: [stationKey(stations[3]), stationKey(stations[7])] });
  const names = f.config().music.stations.map(s => s.name);
  assert.equal(names.length, 23);
  assert.ok(!names.includes('Station 3') && !names.includes('Station 7'));
  const stale = await f.run('admin:removestations:voice:stations', { values: [stationKey(stations[3])] });
  assert.match(f.view(stale).embed.description, /already removed/);
  f.store.setGuildConfig(GUILD, { music: { ...f.config().music, stations: [] } });
  const empty = f.view(await f.run('admin:open:voice:stations'));
  assert.equal(empty.rows[1].components[0].label, 'Add station');
});
