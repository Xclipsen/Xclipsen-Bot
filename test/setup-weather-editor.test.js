const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField, ChannelType } = require('discord.js');
const { createAccessControl } = require('../src/features/accessControl');
const { createSetupEditor } = require('../src/features/setupHub/editor');
const { createSetupHubRenderers } = require('../src/features/setupHub/renderers');
const { interactionIds } = require('../src/config/interactionIds');
const { createWeatherService } = require('../src/features/weather');
const { createTempStore } = require('./helpers');
const GUILD = '1257088955711619163';
const USER = '123456789012345678';
const MILD = '234567890123456789';
const EXTREME = '234567890123456780';
const MOD = '234567890123456781';
const CHANNEL = '345678901234567890';
const OLD_CHANNEL = '345678901234567891';
const CATEGORY = '456789012345678901';
function fixture(t) {
  const { store } = createTempStore(t, 'setup-weather-');
  const accessControl = createAccessControl(new Set(), store);
  const effects = [];
  const created = [];
  const permissions = new PermissionsBitField(Object.values(PermissionsBitField.Flags));
  const role = id => ({ id, managed: false, editable: true, permissions: new PermissionsBitField([]), delete: async () => effects.push('delete-role') });
  const roles = { [MILD]: role(MILD), [EXTREME]: role(EXTREME), [MOD]: { ...role(MOD), permissions: new PermissionsBitField([PermissionsBitField.Flags.ManageMessages]) } };
  const channel = id => ({ id, type: ChannelType.GuildText, permissionsFor: () => permissions, delete: async () => effects.push('delete-channel') });
  const channels = { [CHANNEL]: channel(CHANNEL), [OLD_CHANNEL]: channel(OLD_CHANNEL) };
  const guild = { id: GUILD, name: 'Testing', members: { me: { permissions }, fetch: async id => ({ id }) }, roles: { fetch: async id => roles[id] || null },
    channels: { fetch: async id => channels[id] || null, create: async options => { effects.push('create'); created.push(options); return channels[CHANNEL]; } } };
  // Role safety uses the real check; everything that posts is faked.
  const realWeather = createWeatherService({ client: {}, store, reactionRoles: {} });
  const weather = {
    calls: [],
    locks: [],
    inLock: false,
    withGuildLock: async (guildId, task) => {
      weather.locks.push(guildId);
      weather.inLock = true;
      try { return await task(); } finally { weather.inLock = false; }
    },
    validateWeatherPanelRole: (...args) => realWeather.validateWeatherPanelRole(...args),
    getWeatherSummary: () => 'Mild weather active until <t:1:t>',
    findBotChannelCategoryId: async (...args) => { weather.calls.push(args); effects.push('category'); return CATEGORY; },
    deleteTrackedWeatherMessages: async () => effects.push('delete-messages'),
    deleteWeatherRolePanel: async () => { effects.push('delete-panel'); weather.panelDeletedWith = { inLock: weather.inLock, channelId: store.getGuildConfig(GUILD).weather.channelId }; },
    resolveQuickSetupWeatherRoles: async () => { effects.push('roles'); return { roles: { mild: MILD, extreme: EXTREME }, createdCount: 2 }; },
    postWeatherRolePanel: async (g, c, r) => { effects.push('panel'); weather.panelRoles = r; return { message: { id: '1' }, warnings: ['Panel could not be pinned.'] }; },
    syncWeatherDashboard: async () => effects.push('dashboard'),
    ensureWeatherRolePanel: async () => effects.push('ensure')
  };
  const modUpdates = { deleteTrackedStatusMessages: async () => effects.push('delete-mods') };
  const editor = createSetupEditor({ store, accessControl, setupHub: { takePanelWarnings: () => [] }, mayorAlerts: {}, modUpdates, weather });
  function interaction(customId, values = []) {
    const messages = [];
    return { customId, values, user: { id: USER }, guildId: GUILD, guild, channel: { id: '999999999999999999', parentId: CATEGORY }, member: { roles: [] },
      memberPermissions: new PermissionsBitField([PermissionsBitField.Flags.ManageGuild]), inGuild: () => true, isButton: () => !customId.includes(':save:') && !customId.includes(':field:'),
      messages, reply: async p => messages.push(p), update: async p => messages.push(p), editReply: async p => messages.push(p), deferUpdate: async () => {} };
  }
  async function confirm(customId) {
    const ask = interaction(customId);
    await editor.handle(ask);
    const done = interaction(ask.messages[0].components[0].toJSON().components[0].custom_id);
    await editor.handle(done);
    return done.messages[0].embeds[0].toJSON().description;
  }
  return { store, editor, guild, weather, effects, created, interaction, confirm };
}
test('overview weather button opens the weather section with current weather and actions', async t => {
  const f = fixture(t);
  const i = f.interaction('admin:open:weather:channel');
  assert.equal(await f.editor.handle(i), true);
  const view = i.messages[0];
  const embed = view.embeds[0].toJSON();
  assert.equal(embed.title, 'Admin • SkyBlock Weather');
  assert.equal(embed.fields.find(field => field.name === 'Current weather').value, 'Mild weather active until <t:1:t>');
  assert.match(embed.fields.find(field => field.name === 'Schedule').value, /XX:35.*XX:55/);
  const rows = view.components.map(r => r.toJSON());
  assert.deepEqual(rows[0].components[0].options.map(o => o.value), ['channel', 'mild', 'extreme']);
  const labels = rows.flatMap(r => r.components.map(c => c.label)).filter(Boolean);
  for (const label of ['Create new channel', 'Rebuild posts', 'Auto-create event roles']) assert.ok(labels.includes(label));
  assert.ok(rows.every(r => r.components.length <= 5));
});
test('retired setup-view buttons on panels still open in Discord reach the editor', async t => {
  const f = fixture(t);
  for (const [customId, title] of [['setup-view-weather', 'SkyBlock Weather'], ['setup-view-mayor', 'Mayor Alerts'], ['setup-view-event-reminders', 'Event Calendar'],
    ['setup-view-mining-events', 'Mining Events'], ['setup-view-mod-updates', 'Mod Updates'], ['setup-view-shitter', 'Shitter Permissions']]) {
    const i = f.interaction(customId);
    assert.equal(await f.editor.handle(i), true);
    assert.equal(i.messages[0].embeds[0].toJSON().title, `Admin • ${title}`);
  }
  assert.equal(await f.editor.handle(f.interaction('setup-view-home')), false);
});
test('create places the weather channel in the bot category and builds roles, panel and dashboard', async t => {
  const f = fixture(t);
  const note = await f.confirm('admin:create:weather:channel');
  assert.equal(f.created[0].parent, CATEGORY);
  assert.equal(f.created[0].name, 'skyblock-weather');
  assert.equal(f.created[0].type, ChannelType.GuildText);
  assert.equal(f.weather.calls[0][0], f.guild);
  assert.equal(f.weather.calls[0][1].parentId, CATEGORY);
  const config = f.store.getGuildConfig(GUILD).weather;
  assert.equal(config.channelId, CHANNEL);
  assert.deepEqual({ mild: config.roles.mild, extreme: config.roles.extreme }, { mild: MILD, extreme: EXTREME });
  assert.deepEqual(f.weather.panelRoles, config.roles);
  assert.deepEqual(f.effects, ['category', 'create', 'delete-messages', 'delete-panel', 'roles', 'panel', 'dashboard']);
  assert.match(note, new RegExp(`Created <#${CHANNEL}>`));
  assert.match(note, /Panel could not be pinned/);
});
test('other sections also create their channel next to the bot channels', async t => {
  const f = fixture(t);
  await f.confirm('admin:create:mods:channel');
  assert.equal(f.created[0].parent, CATEGORY);
  assert.equal(f.created[0].name, 'mod-updates');
  f.weather.findBotChannelCategoryId = async () => null;
  await f.confirm('admin:create:mods:channel');
  assert.equal(f.created[1].parent, undefined);
});
test('moving the weather channel removes the old panel and tracked messages first', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { weather: { channelId: OLD_CHANNEL, roles: { mild: MILD, extreme: EXTREME } } });
  await f.editor.handle(f.interaction('admin:save:weather:channel', [CHANNEL]));
  assert.deepEqual(f.effects, ['delete-messages', 'delete-panel', 'panel', 'dashboard']);
  const config = f.store.getGuildConfig(GUILD).weather;
  assert.equal(config.channelId, CHANNEL);
  assert.equal(config.roles.extreme, EXTREME);
  f.effects.length = 0;
  await f.editor.handle(f.interaction('admin:save:weather:mild', [EXTREME]));
  assert.deepEqual(f.effects, ['panel', 'dashboard']);
  assert.equal(f.store.getGuildConfig(GUILD).weather.roles.mild, EXTREME);
  assert.equal(f.store.getGuildConfig(GUILD).weather.channelId, CHANNEL);
});
test('auto-create saves weather roles and only builds posts once a channel exists', async t => {
  const f = fixture(t);
  const note = await f.confirm('admin:auto:weather:channel');
  assert.match(note, /2 created/);
  assert.equal(f.store.getGuildConfig(GUILD).weather.roles.mild, MILD);
  assert.deepEqual(f.effects, ['roles']);
});
test('reset clears weather settings but keeps Discord channels and roles', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: { mild: MILD, extreme: EXTREME } }, miningEvents: { channelId: OLD_CHANNEL, roles: {} } });
  const note = await f.confirm('admin:reset:weather:channel');
  assert.match(note, /channels and roles were kept/);
  const config = f.store.getGuildConfig(GUILD);
  assert.equal(config.weather.channelId, null);
  assert.ok(!Object.values(config.weather.roles).some(Boolean));
  assert.equal(config.miningEvents.channelId, OLD_CHANNEL);
  assert.deepEqual(f.effects, ['delete-panel', 'delete-messages']);
});
test('startup repairs the weather panel only when configured and never throws', async t => {
  const f = fixture(t);
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, []);
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: { mild: MILD, extreme: EXTREME } } });
  await f.editor.ensurePanels(f.guild);
  assert.deepEqual(f.effects, ['ensure']);
  f.weather.ensureWeatherRolePanel = async () => { throw new Error('offline'); };
  await f.editor.ensurePanels(f.guild);
});
test('admin overview lists weather status, next step and a weather button', async t => {
  const f = fixture(t);
  const renderers = createSetupHubRenderers({ store: f.store, interactionIds });
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: {} } });
  const embed = renderers.createSetupHubEmbed(f.guild).toJSON();
  const field = embed.fields.find(entry => entry.name === 'SkyBlock Weather');
  assert.match(field.value, new RegExp(`<#${CHANNEL}>`));
  assert.match(field.value, /Ping roles: 0\/2/);
  assert.match(embed.fields.at(-1).value, /SkyBlock Weather/);
  const rows = renderers.createSetupComponents().map(r => r.toJSON());
  assert.ok(rows.every(r => r.components.length <= 5));
  const buttons = rows.flatMap(r => r.components);
  assert.equal(buttons.find(c => c.custom_id === 'admin:open:weather:channel').label, 'Weather');
  assert.equal(buttons.find(c => c.custom_id === interactionIds.REACTION_EDITOR_OPEN_ID).label, 'Reaction Roles');
  assert.ok(buttons.every(c => !c.custom_id.startsWith('setup-view-') || ['setup-view-home', 'setup-view-player-tools'].includes(c.custom_id)));
});
test('the editor rejects an unsafe weather role before saving it', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: { mild: MILD, extreme: EXTREME } } });
  const moderator = f.interaction('admin:save:weather:mild', [MOD]);
  await f.editor.handle(moderator);
  assert.match(moderator.messages[0].embeds[0].toJSON().description, /Could not finish: .*cannot be a weather ping role: it has the Manage Messages permission/);
  assert.equal(f.store.getGuildConfig(GUILD).weather.roles.mild, MILD);
  f.store.setGuildConfig(GUILD, { botManagers: { userIds: [], roleIds: [EXTREME] } });
  const manager = f.interaction('admin:save:weather:extreme', [EXTREME]);
  await f.editor.handle(manager);
  assert.match(manager.messages[0].embeds[0].toJSON().description, /bot-manager access/);
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: { mild: MILD, extreme: null } } });
  await f.editor.handle(f.interaction('admin:save:weather:extreme', [EXTREME]));
  assert.equal(f.store.getGuildConfig(GUILD).weather.roles.extreme, null);
  assert.deepEqual(f.effects, []);
});
test('weather editor actions hold the weather lock and reset clears the config before deleting posts', async t => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { weather: { channelId: CHANNEL, roles: { mild: MILD, extreme: EXTREME } } });
  await f.editor.handle(f.interaction('admin:save:weather:channel', [OLD_CHANNEL]));
  await f.confirm('admin:reset:weather:channel');
  assert.deepEqual(f.weather.locks, [GUILD, GUILD]);
  assert.deepEqual(f.weather.panelDeletedWith, { inLock: true, channelId: null });
  await f.confirm('admin:create:mods:channel');
  assert.equal(f.weather.locks.length, 2);
});
