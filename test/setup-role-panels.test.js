const test = require('node:test');
const assert = require('node:assert/strict');
const { pinRolePanel, moveTrackedPostsAfterPanels, buildRolePanelEntries, hasOutdatedPanelEmojis } = require('../src/features/setupHub/rolePanels');
const { createSetupHub } = require('../src/features/setupHub');
const { interactionIds } = require('../src/config/interactionIds');

test('pin uses current Discord endpoint and skips already pinned panels', async () => {
  const paths = [];
  const message = { id: '20', channelId: '100', client: { rest: { put: async path => paths.push(path) } } };
  assert.equal(await pinRolePanel(message), null);
  assert.deepEqual(paths, ['/channels/100/messages/pins/20']);
  message.pinned = true;
  await pinRolePanel(message);
  assert.equal(paths.length, 1);
});
test('pin failure is nonfatal and explains the missing permission', async () => {
  const warning = await pinRolePanel({ id: '20', channelId: '100', client: { rest: { put: async () => { throw { code: 50013 }; } } } });
  assert.match(warning, /Pin Messages/);
});
test('tracked old bot messages move below panels without sending mentions', async () => {
  const state = { miningEvents: { dashboardMessageId: '10', pingMessageIds: { raffle: '11', future: '30' }, activeEvents: { raffle: {} } } };
  const sent = [], deleted = [];
  const channel = { messages: { fetch: async id => ({ id, author: { id: 'bot' }, content: '<@&123>', embeds: [{ toJSON: () => ({ title: 'Event' }) }], components: [], delete: async () => deleted.push(id) }) }, send: async payload => { sent.push(payload); return { id: String(40 + sent.length) }; } };
  const store = { getGuildRuntimeState: () => state, updateGuildRuntimeSection: (_, section, patch) => { state[section] = { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) }; } };
  await moveTrackedPostsAfterPanels({ guild: { id: 'guild', client: { user: { id: 'bot' } }, channels: { fetch: async () => channel } }, store, section: 'miningEvents', channelId: '100', afterId: '20' });
  assert.deepEqual(deleted, ['10', '11']);
  assert.ok(sent.every(p => p.allowedMentions.parse.length === 0));
  assert.equal(state.miningEvents.dashboardMessageId, '41');
  assert.equal(state.miningEvents.pingMessageIds.raffle, '42');
  assert.equal(state.miningEvents.pingMessageIds.future, '30');
  assert.deepEqual(state.miningEvents.activeEvents, { raffle: {} });
});
test('tracked references never cause other users messages to be moved', async () => {
  let sent = false;
  await moveTrackedPostsAfterPanels({ guild: { id: 'guild', client: { user: { id: 'bot' } }, channels: { fetch: async () => ({ messages: { fetch: async () => ({ author: { id: 'human' } }) }, send: async () => { sent = true; } }) } }, store: { getGuildRuntimeState: () => ({ eventReminders: { messageIds: { feast: '10' } } }) }, section: 'eventReminders', channelId: '100', afterId: '20' });
  assert.equal(sent, false);
});
test('calendar role panel and pin precede the mayor/calendar status post', async () => {
  const calls = [];
  const state = { eventReminders: { messageIds: {} } };
  const message = { id: '20', channelId: '100', client: { rest: { put: async () => calls.push('pin') } } };
  const channel = { isTextBased: () => true, send: async () => { calls.push('panel'); return message; } };
  const store = { getGuildConfig: () => ({ roleId: '123', channelId: '100', eventReminders: { channelId: '100', roles: { darkAuction: '456' } } }), getGuildRuntimeState: () => state, updateGuildRuntimeSection: (_, section, patch) => { state[section] = { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) }; } };
  const hub = createSetupHub({ store, ensureSetupAccess: async () => true, interactionIds, mayorAlerts: { deleteTrackedMessagesForGuild: async () => calls.push('clear-status'), refreshStatusForGuild: async () => calls.push('status') }, reactionRoles: { addReactionRoleBinding: async () => calls.push('binding') } });
  await hub.postEventRolePanelThenStatus({ id: 'guild', channels: { fetch: async () => channel } });
  assert.deepEqual(calls, ['clear-status', 'panel', 'binding', 'binding', 'pin', 'status']);
  assert.equal(state.eventReminders.rolePanelMessageId, '20');
});

const { PermissionsBitField, ChannelType } = require('discord.js');
const { createAccessControl } = require('../src/features/accessControl');
const { createReactionRoleService } = require('../src/features/reactionRoles');
const { createSetupEditor } = require('../src/features/setupHub/editor');
const { postRolePanel, deleteRolePanels, resolveQuickSetupRoles } = require('../src/features/setupHub/rolePanels');
const { EVENT_DEFINITIONS } = require('../src/features/eventCalendar');
const { createTempStore } = require('./helpers');

const GUILD = '1257088955711619163';
const CHANNEL = '345678901234567890';
const OTHER_CHANNEL = '345678901234567891';
const ROLE = '234567890123456789';
const OTHER_ROLE = '234567890123456780';

function tempStore(t) {
  return createTempStore(t, 'role-panels-').store;
}

// A guild whose text channels record sent and deleted messages; every message id grows like a snowflake.
function fakeGuild() {
  let nextId = 900000000000000000n;
  const permissions = new PermissionsBitField(Object.values(PermissionsBitField.Flags));
  const client = { user: { id: 'bot' }, rest: { put: async () => {} } };
  const channels = {};
  const makeChannel = (id) => {
    const messages = new Map();
    const channel = { id, type: ChannelType.GuildText, isTextBased: () => true, permissionsFor: () => permissions, sent: [], deleted: [],
      messages: { fetch: async (messageId) => messages.get(messageId) || null },
      send: async (payload) => {
        nextId += 1n;
        const message = { id: String(nextId), channelId: id, client, author: { id: 'bot' }, content: payload.content || null, embeds: [], components: [], reactions: { resolve: () => null },
          react: async () => {}, delete: async () => { messages.delete(message.id); channel.deleted.push(message.id); } };
        messages.set(message.id, message);
        channel.sent.push(message);
        return message;
      } };
    return channel;
  };
  channels[CHANNEL] = makeChannel(CHANNEL);
  channels[OTHER_CHANNEL] = makeChannel(OTHER_CHANNEL);
  const roles = { [ROLE]: { id: ROLE, name: 'Dark Auction', managed: false, editable: true, permissions: new PermissionsBitField([]) },
    [OTHER_ROLE]: { id: OTHER_ROLE, name: 'Harvest Feast', managed: false, editable: true, permissions: new PermissionsBitField([]) } };
  return { id: GUILD, client, channels: { fetch: async (id) => channels[id] || null }, channelMap: channels,
    roles: { fetch: async (id) => roles[id] || null }, members: { me: { permissions }, fetch: async (id) => ({ id }) } };
}

function realSetup(t) {
  const store = tempStore(t);
  const guild = fakeGuild();
  const calls = [];
  const mayorAlerts = { deleteTrackedMessagesForGuild: async () => calls.push('clear-status'), refreshStatusForGuild: async () => calls.push('status') };
  const reactionRoles = createReactionRoleService({ client: guild.client, store });
  const accessControl = createAccessControl(new Set(), store);
  const hub = createSetupHub({ store, ensureSetupAccess: accessControl.ensureSetupAccess, mayorAlerts, reactionRoles, interactionIds });
  const editor = createSetupEditor({ store, accessControl, setupHub: hub, mayorAlerts, modUpdates: {} });
  const interaction = (customId, values) => ({ customId, values, user: { id: 'admin' }, guildId: GUILD, guild, member: { roles: [] },
    memberPermissions: new PermissionsBitField([PermissionsBitField.Flags.ManageGuild]), inGuild: () => true, isButton: () => false,
    messages: [], editReply: async function (p) { this.messages.push(p); }, deferUpdate: async () => {} });
  return { store, guild, calls, hub, editor, interaction };
}

test('changing one event role rebuilds the panel without re-announcing running events', async (t) => {
  const f = realSetup(t);
  f.store.setGuildConfig(GUILD, { channelId: CHANNEL, eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  const running = await f.guild.channelMap[CHANNEL].send({ content: 'Dark Auction is running' });
  f.store.setGuildRuntimeState(GUILD, { statusMessageId: '1', statusChannelId: CHANNEL,
    eventReminders: { channelId: CHANNEL, lastSentStarts: { darkAuction: 1000 }, messageIds: { darkAuction: running.id }, messageExpireAts: { darkAuction: 2000 } } });

  await f.editor.handle(f.interaction('admin:save:calendar:harvestFeast', [OTHER_ROLE]));

  const state = f.store.getGuildRuntimeState(GUILD);
  assert.deepEqual(state.eventReminders.lastSentStarts, { darkAuction: 1000 });
  assert.deepEqual(state.eventReminders.messageExpireAts, { darkAuction: 2000 });
  assert.ok(state.eventReminders.messageIds.darkAuction, 'the running event post stays tracked');
  assert.equal(f.store.getGuildConfig(GUILD).eventReminders.roles.harvestFeast, OTHER_ROLE);
  const panelId = state.eventReminders.rolePanelMessageId;
  assert.ok(panelId);
  assert.deepEqual(f.store.getReactionRoleEntries(GUILD).map((entry) => [entry.messageId, entry.roleId]).sort(), [[panelId, ROLE], [panelId, OTHER_ROLE]].sort());
  // The running-event post was moved below the new panel, not deleted from state.
  assert.ok(BigInt(state.eventReminders.messageIds.darkAuction) > BigInt(panelId));
});

test('moving the calendar channel still resets the reminder state and removes the old panel', async (t) => {
  const f = realSetup(t);
  f.store.setGuildConfig(GUILD, { channelId: CHANNEL, eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  await f.hub.postEventRolePanelThenStatus(f.guild);
  const oldPanelId = f.store.getGuildRuntimeState(GUILD).eventReminders.rolePanelMessageId;
  f.store.setGuildRuntimeState(GUILD, { eventReminders: { ...f.store.getGuildRuntimeState(GUILD).eventReminders, lastSentStarts: { darkAuction: 1000 } } });

  await f.editor.handle(f.interaction('admin:save:calendar:channel', [OTHER_CHANNEL]));

  const state = f.store.getGuildRuntimeState(GUILD);
  assert.deepEqual(state.eventReminders.lastSentStarts, {});
  assert.ok(f.guild.channelMap[CHANNEL].deleted.includes(oldPanelId));
  assert.equal(state.eventReminders.rolePanelChannelId, OTHER_CHANNEL);
  assert.ok(f.store.getReactionRoleEntries(GUILD).every((entry) => entry.channelId === OTHER_CHANNEL));
});

test('mining panels are posted per island and removed together', async (t) => {
  const f = realSetup(t);
  f.store.setGuildConfig(GUILD, { miningEvents: { channelId: CHANNEL, roles: { raffle: ROLE, goblinRaid: OTHER_ROLE } } });
  await f.hub.postMiningRolePanels(f.guild, f.guild.channelMap[CHANNEL]);
  const state = f.store.getGuildRuntimeState(GUILD).miningEvents;
  assert.ok(state.dwarvenRolePanelMessageId);
  assert.equal(state.crystalRolePanelMessageId, null, 'no Crystal Hollows roles, no panel');
  assert.equal(f.guild.channelMap[CHANNEL].sent.length, 1);
  assert.equal(f.store.getReactionRoleEntries(GUILD).length, 2);

  await f.hub.deleteMiningRolePanels(f.guild);
  const cleared = f.store.getGuildRuntimeState(GUILD).miningEvents;
  assert.equal(cleared.dwarvenRolePanelMessageId, null);
  assert.equal(cleared.rolePanelChannelId, null);
  assert.deepEqual(f.store.getReactionRoleEntries(GUILD), []);
  assert.deepEqual(f.guild.channelMap[CHANNEL].deleted, [state.dwarvenRolePanelMessageId]);
});

test('a panel whose bindings fail is deleted again and not tracked', async (t) => {
  const store = tempStore(t);
  const guild = fakeGuild();
  const channel = guild.channelMap[CHANNEL];
  let bound = 0;
  const reactionRoles = {
    addReactionRoleBinding: async () => { bound += 1; if (bound === 2) throw new Error('Unknown Emoji'); },
    purgeReactionRoleBindings: (guildId, filter) => { reactionRoles.purged = filter; }
  };
  const entries = [{ key: 'a', label: 'A', emoji: '✅', roleId: ROLE }, { key: 'b', label: 'B', emoji: 'bad', roleId: OTHER_ROLE }];
  await assert.rejects(postRolePanel({ guild, store, reactionRoles, channel, section: 'eventReminders', messageKey: 'rolePanelMessageId', entries, embed: {} }), /Unknown Emoji/);
  assert.deepEqual(channel.deleted, [channel.sent[0].id]);
  assert.deepEqual(reactionRoles.purged, { channelId: CHANNEL, messageId: channel.sent[0].id });
  assert.equal(store.getGuildRuntimeState(GUILD).eventReminders.rolePanelMessageId, null);
});

test('deleting a panel keeps a newer panel that was posted meanwhile', async (t) => {
  const store = tempStore(t);
  const guild = fakeGuild();
  store.setGuildRuntimeState(GUILD, { weather: { rolePanelMessageId: '10', rolePanelChannelId: CHANNEL } });
  const reactionRoles = { purgeReactionRoleBindings: () => store.setGuildRuntimeState(GUILD, { weather: { ...store.getGuildRuntimeState(GUILD).weather, rolePanelMessageId: '20' } }) };
  await deleteRolePanels({ guild, store, reactionRoles, section: 'weather', messageKeys: ['rolePanelMessageId'] });
  assert.equal(store.getGuildRuntimeState(GUILD).weather.rolePanelMessageId, '20');
  assert.equal(store.getGuildRuntimeState(GUILD).weather.rolePanelChannelId, CHANNEL);
});

test('event quick setup never reuses an admin or bot-manager role with a matching name', async () => {
  const definition = EVENT_DEFINITIONS[0];
  const safe = (id, name, permissions = []) => ({ id, name, managed: false, editable: true, permissions: new PermissionsBitField(permissions) });
  const roles = new Map([
    ['1', safe('1', definition.roleName, [PermissionsBitField.Flags.Administrator])],
    ['2', safe('2', `${EVENT_DEFINITIONS[1].roleName} Ping`)],
    ['3', safe('3', EVENT_DEFINITIONS[2].roleName)]
  ]);
  const created = [];
  const guild = { id: GUILD, roles: {
    fetch: async (id) => (id ? roles.get(id) || null : roles),
    create: async ({ name }) => { const role = safe(String(100 + created.length), name); created.push(name); return role; }
  } };
  const result = await resolveQuickSetupRoles(guild, EVENT_DEFINITIONS.slice(0, 3), { [definition.key]: '1' }, ['3']);
  assert.notEqual(result.roles[definition.key], '1');
  assert.equal(result.roles[EVENT_DEFINITIONS[1].key], '2');
  assert.notEqual(result.roles[EVENT_DEFINITIONS[2].key], '3');
  assert.deepEqual(created, [definition.roleName, EVENT_DEFINITIONS[2].roleName]);
  assert.equal(result.createdCount, 2);
});

test('moving the calendar channel removes the old event pings, which are announced again', async (t) => {
  const f = realSetup(t);
  f.store.setGuildConfig(GUILD, { channelId: CHANNEL, eventReminders: { channelId: CHANNEL, roles: { darkAuction: ROLE } } });
  const ping = await f.guild.channelMap[CHANNEL].send({ content: `<@&${ROLE}>\n💵 Dark Auction is active now.` });
  f.store.setGuildRuntimeState(GUILD, { eventReminders: { channelId: CHANNEL, lastSentStarts: { darkAuction: 1000 }, messageIds: { darkAuction: ping.id }, messageExpireAts: { darkAuction: 2000 } } });

  await f.hub.setEventCalendarChannel(f.guild, OTHER_CHANNEL);

  assert.ok(f.guild.channelMap[CHANNEL].deleted.includes(ping.id));
  const state = f.store.getGuildRuntimeState(GUILD).eventReminders;
  assert.deepEqual(state.messageIds, {});
  assert.deepEqual(state.lastSentStarts, {});
  assert.equal(state.channelId, OTHER_CHANNEL);
});

test('panel entries use the item icons and flag panels still bound to other emojis', () => {
  const definitions = [
    { key: 'darkAuction', label: 'Dark Auction', emoji: '💵', icon: 'sb_dark_auction' },
    { key: 'bankInterest', label: 'Bank Interest', emoji: '💰', icon: 'sb_bank_interest' }
  ];
  const roles = { darkAuction: 'r1', bankInterest: 'r1' };
  const loaded = { sb_dark_auction: '<:sb_dark_auction:11>', sb_bank_interest: '<:sb_bank_interest:12>' };
  const appEmojis = { get: (name, fallback) => loaded[name] || fallback, has: (name) => Boolean(loaded[name]) };
  const entries = buildRolePanelEntries(definitions, roles, appEmojis);
  assert.deepEqual(entries.map((entry) => entry.emoji), ['<:sb_dark_auction:11>', '<:sb_bank_interest:12>']);

  const message = { id: 'm', channelId: 'c' };
  let bindings = [
    { channelId: 'c', messageId: 'm', roleId: 'r1', emoji: '💵' },
    { channelId: 'c', messageId: 'm', roleId: 'r1', emoji: '💰' }
  ];
  const store = { getReactionRoleEntries: () => bindings };
  assert.equal(hasOutdatedPanelEmojis(store, 'g', message, entries), true);

  // Two events sharing one role must not look outdated forever.
  bindings = [
    { channelId: 'c', messageId: 'm', roleId: 'r1', emoji: '11' },
    { channelId: 'c', messageId: 'm', roleId: 'r1', emoji: '12' }
  ];
  assert.equal(hasOutdatedPanelEmojis(store, 'g', message, entries), false);

  // Without the icons loaded the Unicode fallback must not replace a panel that already shows them.
  delete loaded.sb_bank_interest;
  bindings = [{ channelId: 'c', messageId: 'm', roleId: 'r1', emoji: '💵' }];
  assert.equal(hasOutdatedPanelEmojis(store, 'g', message, buildRolePanelEntries(definitions, roles, appEmojis)), false);
  assert.equal(hasOutdatedPanelEmojis(store, 'g', null, entries), false);
});
