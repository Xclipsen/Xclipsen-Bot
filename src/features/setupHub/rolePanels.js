const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { NO_APP_EMOJIS } = require('../../utils/appEmojis');

// Reaction panels let any member self-assign their roles, so those roles must
// never carry moderation or management access.
const UNSAFE_PANEL_ROLE_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'ManageMessages',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers'
];

function getPanelRoleProblem(guild, role, managerRoleIds) {
  if (!role || role.id === guild.id || role.managed) {
    return 'is not a regular role in this server';
  }

  if (!role.editable) {
    return 'cannot be assigned by the bot (it needs Manage Roles and a higher role)';
  }

  if (managerRoleIds.includes(role.id)) {
    return 'grants bot-manager access';
  }

  const permission = UNSAFE_PANEL_ROLE_PERMISSIONS.find((key) => role.permissions.has(PermissionsBitField.Flags[key]));
  return permission ? `has the ${permission.replace(/([a-z])([A-Z])/g, '$1 $2')} permission` : null;
}

// Throws a readable error when the role must not be handed out through reactions.
async function validatePanelRole(guild, roleId, managerRoleIds, label = 'reaction role') {
  const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
  const problem = getPanelRoleProblem(guild, role, managerRoleIds);
  if (problem) {
    throw new Error(`<@&${roleId}> cannot be a ${label}: it ${problem}.`);
  }

  return role;
}

function normalizeRoleLookupValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findMatchingRoleId(roles, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeRoleLookupValue(alias));
  const match = roles.find((role) => normalizedAliases.includes(normalizeRoleLookupValue(role.name)));
  return match?.id || null;
}

// Keeps safe configured roles, reuses safe roles with a matching name and creates the rest.
// Unsafe roles (admin, moderation, bot-manager) are never reused, even if their name matches.
async function resolveQuickSetupRoles(guild, definitions, configuredRoles, managerRoleIds) {
  const isSafeRole = (role) => !getPanelRoleProblem(guild, role, managerRoleIds);
  const fetchedRoles = await guild.roles.fetch();
  const roles = [...fetchedRoles.values()].filter((role) => role && isSafeRole(role));
  const resolvedRoles = Object.fromEntries(definitions.map((definition) => [definition.key, null]));
  let createdCount = 0;

  for (const definition of definitions) {
    const configuredRoleId = configuredRoles?.[definition.key] || null;
    if (configuredRoleId) {
      const configuredRole = await guild.roles.fetch(configuredRoleId).catch(() => null);
      if (configuredRole && isSafeRole(configuredRole)) {
        resolvedRoles[definition.key] = configuredRole.id;
        continue;
      }
    }

    const existingRoleId = findMatchingRoleId(roles, [
      definition.roleName,
      `${definition.roleName} Ping`,
      `${definition.roleName} Role`,
      ...definition.roleAliases
    ]);
    if (existingRoleId) {
      resolvedRoles[definition.key] = existingRoleId;
      continue;
    }

    const createdRole = await guild.roles.create({
      name: definition.roleName,
      mentionable: false,
      reason: `Quick setup for the ${definition.label} ping role`
    });
    roles.push(createdRole);
    resolvedRoles[definition.key] = createdRole.id;
    createdCount += 1;
  }

  return { roles: resolvedRoles, createdCount };
}

// Panels react with the item icon (application emoji) and fall back to the Unicode emoji while it is not loaded.
function buildRolePanelEntries(definitions, roles, appEmojis = NO_APP_EMOJIS) {
  return definitions
    .filter((definition) => roles?.[definition.key])
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      emoji: appEmojis.get(definition.icon, definition.emoji),
      iconReady: !definition.icon || appEmojis.has(definition.icon),
      roleId: roles[definition.key]
    }));
}

function getEmojiIdentifier(emoji) {
  const raw = String(emoji || '').trim();
  return raw.match(/^<a?:[^:]+:(\d+)>$/)?.[1] || raw;
}

// True when a role on the posted panel is bound to a different emoji than the panel would use now
// (e.g. the Unicode emojis of panels posted before the item icons). Only meaningful once every icon
// is loaded, otherwise a Unicode fallback would replace a panel that already shows the icons.
function hasOutdatedPanelEmojis(store, guildId, message, entries) {
  if (!message || entries.some((entry) => entry.iconReady === false)) {
    return false;
  }

  const roleIds = new Set(entries.map((entry) => entry.roleId));
  const expected = new Set(entries.map((entry) => `${entry.roleId}/${getEmojiIdentifier(entry.emoji)}`));
  return store.getReactionRoleEntries(guildId)
    .filter((binding) => binding.channelId === message.channelId && binding.messageId === message.id && roleIds.has(binding.roleId))
    .some((binding) => !expected.has(`${binding.roleId}/${binding.emoji}`));
}

function createRolePanelEmbed({ color, title, intro, entries }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription([intro, '', ...entries.map((entry) => `${entry.emoji} <@&${entry.roleId}> - ${entry.label}`)].join('\n'))
    .setFooter({ text: 'The bot adds or removes the matching role when you react.' });
}

// Removes the tracked panel messages of a section (runtime state `<messageKey>` + shared `rolePanelChannelId`)
// together with their reaction-role bindings.
async function deleteRolePanels({ guild, store, reactionRoles, section, messageKeys }) {
  const runtimeState = store.getGuildRuntimeState(guild.id)[section];
  const channelId = runtimeState.rolePanelChannelId;
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  const deletedIds = {};

  for (const messageKey of messageKeys) {
    const messageId = runtimeState[messageKey];
    if (!messageId) {
      continue;
    }

    deletedIds[messageKey] = messageId;
    // The message id keeps the purge filter narrow even when the channel is unknown.
    reactionRoles.purgeReactionRoleBindings(guild.id, { channelId: channelId || undefined, messageId });
    const message = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
    await message?.delete().catch(() => null);
  }

  // Only clear what was deleted; a newer panel posted meanwhile stays tracked.
  store.updateGuildRuntimeSection(guild.id, section, (latest) => {
    const next = { ...latest };
    for (const [messageKey, messageId] of Object.entries(deletedIds)) {
      if (next[messageKey] === messageId) next[messageKey] = null;
    }
    if (messageKeys.every((messageKey) => !next[messageKey])) next.rolePanelChannelId = null;
    return next;
  });
}

// Posts one panel, binds every entry's emoji and tracks it in runtime state. If a binding fails,
// the half-built panel and its bindings are removed again before the error propagates.
async function postRolePanel({ guild, store, reactionRoles, channel, section, messageKey, entries, embed }) {
  const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  try {
    for (const entry of entries) {
      await reactionRoles.addReactionRoleBinding(guild.id, message, entry.roleId, entry.emoji);
    }
  } catch (error) {
    reactionRoles.purgeReactionRoleBindings(guild.id, { channelId: message.channelId, messageId: message.id });
    await message.delete().catch(() => null);
    throw error;
  }

  store.updateGuildRuntimeSection(guild.id, section, { [messageKey]: message.id, rolePanelChannelId: channel.id });
  return { message, warning: await pinRolePanel(message) };
}

// Pinning uses Discord's current endpoint; older discord.js versions still use the deprecated route.
async function pinRolePanel(message) {
  if (message.pinned) return null;
  try {
    await message.client.rest.put(`/channels/${message.channelId}/messages/pins/${message.id}`, { reason: 'Keep bot role selection easy to find' });
    return null;
  } catch (error) {
    const warning = `Role panel posted, but could not be pinned in <#${message.channelId}>. Check the bot's Pin Messages permission and the channel's pin limit.`;
    console.warn(`Role panel pin failed in ${message.channelId}: ${error.code || 'unknown'}`);
    return warning;
  }
}

// Repost only tracked bot messages, preserving content without pinging roles again.
async function moveTrackedPostsAfterPanels({ guild, store, section, channelId, afterId }) {
  const config = store.getGuildRuntimeState(guild.id)[section];
  const hasDashboard = section === 'miningEvents' || section === 'weather';
  const fields = hasDashboard ? ['dashboardMessageId'] : [];
  const mapKey = hasDashboard ? 'pingMessageIds' : 'messageIds';
  const entries = [
    ...fields.map(key => ({ key, messageId: config[key] })),
    ...Object.entries(config[mapKey] || {}).map(([key, messageId]) => ({ key, messageId, map: true }))
  ].filter(e => e.messageId && BigInt(e.messageId) < BigInt(afterId));
  const channel = await guild.channels.fetch(channelId);
  for (const entry of entries) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (!message || message.author?.id !== guild.client.user.id) continue;
    const replacement = await channel.send({ content: message.content || null,
      embeds: message.embeds.map(e => e.toJSON()), components: message.components.map(c => c.toJSON()), allowedMentions: { parse: [] } });
    store.updateGuildRuntimeSection(guild.id, section, (latest) => (entry.map
      ? { [mapKey]: { ...latest[mapKey], [entry.key]: replacement.id } }
      : { [entry.key]: replacement.id }));
    await message.delete();
  }
}

module.exports = {
  getPanelRoleProblem,
  validatePanelRole,
  resolveQuickSetupRoles,
  buildRolePanelEntries,
  hasOutdatedPanelEmojis,
  createRolePanelEmbed,
  deleteRolePanels,
  postRolePanel,
  pinRolePanel,
  moveTrackedPostsAfterPanels
};
