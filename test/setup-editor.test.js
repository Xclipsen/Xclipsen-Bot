const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField, ChannelType } = require('discord.js');
const { createAccessControl } = require('../src/features/accessControl');
const { createSetupEditor, SECTIONS } = require('../src/features/setupHub/editor');
const { createTempStore } = require('./helpers');
const GUILD = '1257088955711619163';
const USER = '123456789012345678';
const ROLE = '234567890123456789';
const CHANNEL = '345678901234567890';
function fixture(t, elevated = false) {
  const { store } = createTempStore(t, 'setup-editor-');
  const accessControl = createAccessControl(new Set(), store);
  const effects = [];
  const outdatedPanels = new Set();
  const permissions = new PermissionsBitField(Object.values(PermissionsBitField.Flags));
  const role = { id: ROLE, managed: false, editable: true, permissions: new PermissionsBitField(elevated ? [PermissionsBitField.Flags.ManageRoles] : []) };
  const channel = { id: CHANNEL, type: ChannelType.GuildText, permissionsFor: () => permissions };
  const guild = { id: GUILD, name: 'Testing', members: { me: { permissions }, fetch: async id => ({ id }) }, roles: { fetch: async id => id === ROLE ? role : null }, channels: { fetch: async id => id === CHANNEL ? channel : null, create: async () => { effects.push('create'); return channel; } } };
  const setupHub = {
    setEventCalendarChannel: async (g, channelId) => {
      effects.push('calendar'); store.setGuildConfig(g.id, { channelId, eventReminders: { ...store.getGuildConfig(g.id).eventReminders, channelId } });
    },
    deleteMiningRolePanels: async () => effects.push('delete-mining'),
    postMiningRolePanels: async () => effects.push('post-mining'),
    postEventRolePanelThenStatus: async () => effects.push('post-calendar'),
    resolveQuickSetupEventRoles: async () => ({ roles: { darkAuction: ROLE }, createdCount: 0 }),
    resolveQuickSetupMiningEventRoles: async () => ({ roles: { raffle: ROLE }, createdCount: 0 }),
    hasOutdatedEventPanel: () => outdatedPanels.has('calendar'),
    hasOutdatedMiningPanel: (guildId, island) => outdatedPanels.has(island),
    takePanelWarnings: () => []
  };
  const modUpdates = { deleteTrackedStatusMessages: async () => effects.push('delete-mods'), syncStatusMessage: async () => effects.push('post-mods'), parseTrackedReposInput: () => [] };
  const mayorAlerts = { deleteTrackedMessagesForGuild: async () => effects.push('delete-mayor'), refreshStatusForGuild: async () => effects.push('post-mayor') };
  const editor = createSetupEditor({ store, accessControl, setupHub, mayorAlerts, modUpdates });
  function interaction(customId, values = [], admin = false) {
    const messages = [];
    return { customId, values, user: { id: USER }, guildId: GUILD, guild, member: { roles: [] }, memberPermissions: new PermissionsBitField(admin ? [PermissionsBitField.Flags.ManageGuild] : []),
      inGuild: () => true, isButton: () => !customId.includes(':save:') && !customId.includes(':field:'),
      messages, reply: async p => messages.push(p), update: async p => messages.push(p), editReply: async p => messages.push(p), deferUpdate: async () => {} };
  }
  return { store, editor, accessControl, guild, channel, interaction, effects, outdatedPanels };
}
test('delegated access persists and cannot grant further access', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: [USER], roleIds: [] } });
  f.store.setGuildConfig(GUILD, { roleId: ROLE });
  assert.equal(await f.accessControl.ensureSetupAccess(f.interaction(''), 'test'), true);
  const i = f.interaction('admin:save:access:roleIds', [ROLE]);
  await f.editor.handle(i);
  assert.deepEqual(f.store.getGuildConfig(GUILD).botManagers.roleIds, []);
  assert.match(i.messages[0].content, /Only server administrators/);
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: [], roleIds: [] } });
  assert.equal(await f.accessControl.ensureSetupAccess(f.interaction(''), 'test'), false);
});
test('role-based managers work with both Discord member shapes', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: [], roleIds: [ROLE] } });
  const i = f.interaction('');
  i.member.roles = [ROLE];
  assert.equal(f.accessControl.isBotManager(i), true);
  i.member.roles = { cache: new Map([[ROLE, {}]]) };
  assert.equal(f.accessControl.isBotManager(i), true);
});
test('ordinary users cannot mutate settings and server administrators can grant managers', async t => {
  const f = fixture(t);
  await f.editor.handle(f.interaction('admin:save:mayor:role', [ROLE]));
  assert.equal(f.store.getGuildConfig(GUILD).roleId, null);
  await f.editor.handle(f.interaction('admin:save:access:userIds', [USER], true));
  assert.deepEqual(f.store.getGuildConfig(GUILD).botManagers.userIds, [USER]);
});
test('every setting renders valid Discord components within payload limits', t => {
  const f = fixture(t);
  for (const [section, definition] of Object.entries(SECTIONS)) for (const [field] of definition.fields) {
    const view = f.editor.render(f.guild, section, field);
    const rows = view.components.map(r => r.toJSON());
    assert.ok(rows.length <= 5);
    assert.ok(rows.every(r => r.components.length <= 5));
    const ids = rows.flatMap(r => r.components.map(c => c.custom_id));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(JSON.stringify(view.embeds[0].toJSON()).length < 6000);
  }
});
test('manager can move mayor channel without personal Send Messages permission', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: [USER], roleIds: [] } });
  const i = f.interaction('admin:save:mayor:channel', [CHANNEL]);
  assert.equal(i.memberPermissions.has(PermissionsBitField.Flags.SendMessages), false);
  await f.editor.handle(i);
  assert.equal(f.store.getGuildConfig(GUILD).eventReminders.channelId, CHANNEL);
  assert.deepEqual(f.effects, ['calendar', 'post-calendar']);
});
test('missing bot permissions or invalid foreign channels prevent changes', async t => {
  const f = fixture(t);
  f.channel.permissionsFor = () => new PermissionsBitField([]);
  await f.editor.handle(f.interaction('admin:save:mayor:channel', [CHANNEL], true));
  assert.deepEqual(f.effects, []);
  assert.equal(f.store.getGuildConfig(GUILD).channelId, null);
  await f.editor.handle(f.interaction('admin:save:mayor:channel', ['999999999999999999'], true));
  assert.deepEqual(f.effects, []);
});
test('reset requires confirmation and only resets the named module', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { roleId: ROLE, eventReminders: { channelId: CHANNEL }, modUpdates: { channelId: CHANNEL, trackedRepos: ['owner/repo'] } });
  const ask = f.interaction('admin:reset:mods:channel', [], true);
  await f.editor.handle(ask);
  assert.equal(f.store.getGuildConfig(GUILD).modUpdates.channelId, CHANNEL);
  const confirmId = ask.messages[0].components[0].toJSON().components[0].custom_id;
  await f.editor.handle(f.interaction(confirmId, [], true));
  assert.equal(f.store.getGuildConfig(GUILD).modUpdates.channelId, null);
  assert.equal(f.store.getGuildConfig(GUILD).eventReminders.channelId, CHANNEL);
  assert.equal(f.store.getGuildConfig(GUILD).roleId, ROLE);
  await f.editor.handle(f.interaction(confirmId, [], true));
  assert.deepEqual(f.effects, ['delete-mods']);
});
test('confirmation cannot be used by a different user', async t => {
  const f = fixture(t);
  const ask = f.interaction('admin:create:mayor:channel', [], true);
  await f.editor.handle(ask);
  const confirmId = ask.messages[0].components[0].toJSON().components[0].custom_id;
  const other = f.interaction(confirmId, [], true); other.user.id = ROLE;
  await f.editor.handle(other);
  assert.deepEqual(f.effects, []);
  await f.editor.handle(f.interaction(confirmId, [], true));
  assert.deepEqual(f.effects, ['create', 'calendar', 'post-calendar']);
});
test('rebuild refuses event panels with roles that grant server management', async t => {
  const f = fixture(t, true);
  f.store.setGuildConfig(GUILD, { miningEvents: { channelId: CHANNEL, roles: { raffle: ROLE } } });
  const i = f.interaction('admin:rebuild:mining:channel', [], true);
  await f.editor.handle(i);
  assert.ok(!f.effects.includes('post-mining'));
  assert.match(i.messages[0].embeds[0].toJSON().description, /cannot be a mining event ping role: it has the Manage Roles permission/);
});
test('rebuild refuses a bot-manager role in event panels', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { botManagers: { roleIds: [ROLE], userIds: [] }, miningEvents: { channelId: CHANNEL, roles: { raffle: ROLE } } });
  await f.editor.handle(f.interaction('admin:rebuild:mining:channel', [], true));
  assert.ok(!f.effects.includes('post-mining'));
});
test('setting one event role preserves other roles and channel', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  await f.editor.handle(f.interaction('admin:save:calendar:harvestFeast', [ROLE], true));
  const config = f.store.getGuildConfig(GUILD).eventReminders;
  assert.equal(config.roles.darkAuction, ROLE);
  assert.equal(config.roles.harvestFeast, ROLE);
  assert.equal(config.channelId, CHANNEL);
  assert.deepEqual(f.effects, ['post-calendar'], 'a role change rebuilds the panel without moving the calendar');
});
test('mining event choices identify the island in both menu and selected field', t => {
  const f = fixture(t);
  const view = f.editor.render(f.guild, 'mining', 'doublePowderCrystal');
  const options = view.components[0].toJSON().components[0].options;
  assert.equal(new Set(options.map(o => o.label)).size, options.length);
  assert.equal(options.find(o => o.value === 'doublePowderDwarven').label, '2x Powder — Dwarven Mines');
  assert.equal(options.find(o => o.value === 'doublePowderCrystal').label, '2x Powder — Crystal Hollows');
  assert.equal(view.embeds[0].toJSON().fields[0].name, '2x Powder — Crystal Hollows');
});
test('startup keeps correctly ordered existing panels instead of posting duplicates', async t => {
  const f = fixture(t);
  f.guild.client = { user: { id: 'bot' } };
  f.channel.messages = { fetch: async messageId => ({ id: messageId, pinned: true, author: { id: 'bot' } }) };
  f.store.setGuildConfig(GUILD, { eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  f.store.setGuildRuntimeState(GUILD, { statusChannelId: CHANNEL, statusMessageId: '30', eventReminders: { rolePanelMessageId: '20', rolePanelChannelId: CHANNEL } });
  await f.editor.ensurePanels(f.guild);
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, []);
});
test('startup rebuilds panels when the old status is above them', async t => {
  const f = fixture(t);
  f.guild.client = { user: { id: 'bot' } };
  f.channel.messages = { fetch: async messageId => ({ id: messageId, pinned: true, author: { id: 'bot' } }) };
  f.store.setGuildConfig(GUILD, { eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  f.store.setGuildRuntimeState(GUILD, { statusChannelId: CHANNEL, statusMessageId: '10', eventReminders: { rolePanelMessageId: '20', rolePanelChannelId: CHANNEL } });
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, ['post-calendar']);
});
test('startup rebuilds panels that still react with other emojis than the item icons', async t => {
  const f = fixture(t);
  f.guild.client = { user: { id: 'bot' } };
  f.channel.messages = { fetch: async messageId => ({ id: messageId, pinned: true, author: { id: 'bot' } }) };
  f.store.setGuildConfig(GUILD, { eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } }, miningEvents: { channelId: CHANNEL, roles: { raffle: ROLE } } });
  f.store.setGuildRuntimeState(GUILD, { statusChannelId: CHANNEL, statusMessageId: '30', eventReminders: { rolePanelMessageId: '20', rolePanelChannelId: CHANNEL }, miningEvents: { dwarvenRolePanelMessageId: '21', rolePanelChannelId: CHANNEL } });
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, []);
  f.outdatedPanels.add('calendar').add('DWARVEN_MINES');
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, ['post-calendar', 'post-mining']);
});
test('adding/removing entries preserves lists longer than Discord selection limit', async t => {
  const f = fixture(t);
  const users = Array.from({ length: 70 }, (_, i) => String(400000000000000000n + BigInt(i)));
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: users, roleIds: [] } });
  await f.editor.handle(f.interaction('admin:save:access:userIds', [USER], true));
  assert.equal(f.store.getGuildConfig(GUILD).botManagers.userIds.length, 71);
  await f.editor.handle(f.interaction('admin:removeitems:access:userIds', [USER], true));
  assert.deepEqual(f.store.getGuildConfig(GUILD).botManagers.userIds, users);
});
test('old separate calendar panel settings migrate to the mayor channel', async t => {
  const f = fixture(t);
  f.guild.client = { user: { id: 'bot' } };
  f.channel.messages = { fetch: async () => null };
  f.store.setGuildConfig(GUILD, { eventReminders: { channelId: CHANNEL, rolePanelChannelId: '999999999999999999', roles: { darkAuction: ROLE } } });
  f.store.setGuildRuntimeState(GUILD, { eventReminders: { rolePanelMessageId: '20', rolePanelChannelId: '999999999999999999' } });
  await f.editor.ensurePanels(f.guild);
  assert.ok(!('rolePanelChannelId' in f.store.getGuildConfig(GUILD).eventReminders));
  assert.deepEqual(f.effects, ['post-calendar']);
  const options = f.editor.render(f.guild, 'calendar').components[0].toJSON().components[0].options;
  assert.ok(!options.some(option => option.value === 'panel'));
});
