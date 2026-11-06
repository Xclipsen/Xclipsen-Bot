const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField } = require('discord.js');
const { createReactionEditor, parseMessageLink } = require('../src/features/setupHub/reactionEditor');
const { createReactionRoleService } = require('../src/features/reactionRoles');
const GUILD = '1257088955711619163';
test('existing message links must belong to the current server', () => {
  assert.deepEqual(parseMessageLink(`https://discord.com/channels/${GUILD}/123456789012345678/234567890123456789`, GUILD), { channelId: '123456789012345678', messageId: '234567890123456789' });
  assert.equal(parseMessageLink('', GUILD), null);
  assert.throws(() => parseMessageLink('https://discord.com/channels/999999999999999999/123456789012345678/234567890123456789', GUILD));
  assert.throws(() => parseMessageLink('123', GUILD));
});
test('bindings are browsable past page one and removing one needs its selection first', async () => {
  let entries = Array.from({ length: 50 }, (_, i) => ({ channelId: '123456789012345678', messageId: String(300000000000000000n + BigInt(i)), roleId: '234567890123456789', emoji: '✅' }));
  let payload;
  const store = { getReactionRoleEntries: () => entries, setReactionRoleEntries: (_, next) => { entries = next; } };
  const removedReactions = [];
  const message = { reactions: { resolve: emoji => ({ remove: async () => removedReactions.push(emoji) }) } };
  const channel = { isTextBased: () => true, messages: { fetch: async () => message } };
  const editor = createReactionEditor({ store, reactionRoles: createReactionRoleService({ store }), accessControl: { ensureServerAccess: async () => true } });
  const i = { guildId: GUILD, guild: { id: GUILD, roles: { cache: new Map() }, channels: { cache: new Map(), fetch: async () => channel } }, user: { id: 'owner' }, update: async p => { payload = p; }, reply: async p => { payload = p; }, editReply: async p => { payload = p; }, deferUpdate: async () => {} };
  await editor.handle({ ...i, customId: 'setup-view-reaction-roles' });
  const token = payload.components[0].toJSON().components[0].custom_id.split(':')[1];
  await editor.handle({ ...i, customId: `rr:${token}:browse-6` });
  assert.match(payload.embeds[0].toJSON().footer.text, /Page 7\/7/);
  assert.equal(payload.components[0].toJSON().components[0].options.length, 2);
  await editor.handle({ ...i, customId: `rr:${token}:delete` });
  assert.equal(entries.length, 50);
  await editor.handle({ ...i, customId: `rr:${token}:browse-6` });
  await editor.handle({ ...i, customId: `rr:${token}:select`, values: ['1'] });
  assert.equal(entries.length, 50);
  await editor.handle({ ...i, customId: `rr:${token}:delete` });
  assert.equal(entries.length, 49);
  assert.equal(entries.at(-1).messageId, '300000000000000048');
  assert.deepEqual(removedReactions, ['✅'], 'the panel reaction is removed like /reactionrole remove does');
});
test('new binding UI uses native channel/role selectors and rejects another user session', async () => {
  let payload;
  const editor = createReactionEditor({ store: { getReactionRoleEntries: () => [] }, accessControl: { ensureServerAccess: async () => true } });
  const i = { guildId: GUILD, guild: { id: GUILD }, user: { id: 'owner' }, update: async p => { payload = p; }, reply: async p => { payload = p; } };
  await editor.handle({ ...i, customId: 'setup-view-reaction-roles' });
  const token = payload.components[1].toJSON().components[0].custom_id.split(':')[1];
  await editor.handle({ ...i, customId: `rr:${token}:add` });
  const rows = payload.components.map(r => r.toJSON());
  assert.deepEqual(rows.slice(0, 3).map(r => r.components[0].type), [8, 6, 6]);
  assert.equal(rows.length, 5);
  await editor.handle({ ...i, customId: `rr:${token}:add`, user: { id: 'other' } });
  assert.match(payload.content, /belongs to another user/);
});
test('reaction roles refuse roles with moderation or bot-manager access', async () => {
  const ROLE = '234567890123456789';
  const role = { id: ROLE, managed: false, editable: true, permissions: new PermissionsBitField([PermissionsBitField.Flags.BanMembers]) };
  const message = { id: '300000000000000000', channelId: '123456789012345678', url: 'https://discord.com/x', react: async () => { throw new Error('must not react'); } };
  const channel = { id: '123456789012345678', isTextBased: () => true, permissionsFor: () => new PermissionsBitField(Object.values(PermissionsBitField.Flags)), messages: { fetch: async () => message } };
  let entries = [];
  const store = { getGuildConfig: () => ({ botManagers: { roleIds: [] } }), getReactionRoleEntries: () => entries, setReactionRoleEntries: (_, next) => { entries = next; } };
  const replies = [];
  const service = createReactionRoleService({ store, ensureServerAccess: async () => true });
  await service.handleReactionRoleCommand({
    guildId: GUILD, guild: { id: GUILD, channels: { fetch: async () => channel }, roles: { fetch: async () => role } },
    options: { getSubcommand: () => 'add', getChannel: () => channel, getString: name => (name === 'message_id' ? message.id : '✅'), getRole: name => (name === 'role' ? role : null) },
    reply: async p => replies.push(p)
  });
  assert.match(replies[0].content, /cannot be a reaction role: it has the Ban Members permission/);
  assert.deepEqual(entries, []);

  // The editor applies the same check before posting a panel.
  let payload;
  const editor = createReactionEditor({ store, reactionRoles: service, accessControl: { ensureServerAccess: async () => true },
    setupEditor: { validateChannel: async () => channel } });
  const i = { guildId: GUILD, guild: { id: GUILD, roles: { fetch: async () => role }, members: { me: { permissions: new PermissionsBitField(Object.values(PermissionsBitField.Flags)) } } },
    user: { id: 'owner' }, update: async p => { payload = p; }, reply: async p => { payload = p; }, editReply: async p => { payload = p; }, deferUpdate: async () => {} };
  await editor.handle({ ...i, customId: 'reaction-editor-open' });
  const token = payload.components.at(-1).toJSON().components[0].custom_id.split(':')[1];
  await editor.handle({ ...i, customId: `rr:${token}:channel`, values: [channel.id] });
  await editor.handle({ ...i, customId: `rr:${token}:role`, values: [ROLE] });
  await editor.handle({ ...i, customId: `rr:${token}:save` });
  assert.match(payload.embeds[0].toJSON().description, /has the Ban Members permission/);
  assert.deepEqual(entries, []);
});
