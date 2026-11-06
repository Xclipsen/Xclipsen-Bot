process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageFlags, PermissionsBitField } = require('discord.js');

const { createAccessControl } = require('../src/features/accessControl');
const { createShitterListFeature } = require('../src/features/shitterList');
const { createTempStore } = require('./helpers');

const GUILD = '1257088955711619163';
const USER = '123456789012345678';
const PRIVILEGED = '123456789012345679';
const ROLE = '234567890123456789';

function fixture(t) {
  const { store } = createTempStore(t, 'shitter-list-');
  const linkStore = { async getBridgeLinkedAccount() { return null; } };
  const feature = createShitterListFeature({ store, linkStore, accessControl: createAccessControl(new Set([PRIVILEGED]), store), pagedLists: {} });
  const run = async (subcommand, { userId = USER, name = 'Player', roles = [], admin = false } = {}) => {
    const replies = [];
    await feature.handleShitterCommand({
      guildId: GUILD, user: { id: userId }, member: { roles: { cache: new Map(roles.map((id) => [id, {}])) } }, inGuild: () => true, guild: { id: GUILD },
      memberPermissions: new PermissionsBitField(admin ? [PermissionsBitField.Flags.ManageGuild] : []),
      options: { getSubcommand: () => subcommand, getString: (key) => ({ name, reason: 'griefing' })[key] ?? null, getAttachment: () => null },
      reply: async (payload) => replies.push(payload)
    });
    return replies[0];
  };
  return { store, run };
}

test('blocked members cannot add or remove entries and the reply names the action', async (t) => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, { shitterPermissions: { blockedUserIds: [USER], blockedRoleIds: [], allowedRoleIds: [] } });
  assert.match((await f.run('add')).content, /blocked from adding shitter entries/);
  assert.match((await f.run('remove')).content, /blocked from removing shitter entries/);
  assert.deepEqual(f.store.getShitterEntries(GUILD), []);
});

test('bot managers and privileged users are exempt from shitter restrictions like Manage Server', async (t) => {
  const f = fixture(t);
  f.store.setGuildConfig(GUILD, {
    botManagers: { userIds: [], roleIds: [ROLE] },
    shitterPermissions: { blockedUserIds: [USER, PRIVILEGED], blockedRoleIds: [], allowedRoleIds: ['345678901234567890'] }
  });
  await f.run('add', { roles: [ROLE] });
  await f.run('add', { userId: PRIVILEGED, name: 'Other' });
  assert.deepEqual(f.store.getShitterEntries(GUILD).map((entry) => entry.ign), ['Player', 'Other']);
  const removal = await f.run('remove', { roles: [ROLE] });
  assert.equal(removal.flags, MessageFlags.Ephemeral);
  assert.ok(f.store.getShitterEntries(GUILD).find((entry) => entry.ign === 'Player').removedAt);
});

test('without a name and without a link the reply explains how to link', async (t) => {
  const f = fixture(t);
  const reply = await f.run('query', { name: null });
  assert.match(reply.content, /Pass `name:`/);
  assert.match(reply.content, /`\/link username:<ign>`/);
  assert.match((await f.run('query', { name: 'no spaces allowed' })).content, /IGN muss 3 bis 16 Zeichen/);
});
