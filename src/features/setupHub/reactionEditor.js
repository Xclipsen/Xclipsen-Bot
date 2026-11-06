const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
  ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionsBitField } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { pinRolePanel, getPanelRoleProblem } = require('./rolePanels');
const { interactionIds } = require('../../config/interactionIds');
// The retired setup view id still opens the editor from panels that are open in Discord.
const ENTRY_POINT_IDS = [interactionIds.REACTION_EDITOR_OPEN_ID, 'setup-view-reaction-roles'];
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const bindingKey = entry => JSON.stringify([entry.channelId, entry.messageId, entry.emoji]);
function parseMessageLink(value, guildId) {
  if (!value.trim()) return null;
  const match = value.trim().match(/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{16,20})\/(\d{16,20})\/(\d{16,20})(?:\?.*)?$/);
  if (!match || match[1] !== guildId) throw new Error('Paste a Discord message link from this server.');
  return { channelId: match[2], messageId: match[3] };
}
function createReactionEditor({ store, reactionRoles, accessControl, setupEditor, setupHub }) {
  const sessions = new Map();
  const working = new Set();
  function button(token, action, label, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder().setCustomId(`rr:${token}:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);
  }
  function draftView(token, note = '') {
    const draft = sessions.get(token);
    const channel = new ChannelSelectMenuBuilder().setCustomId(`rr:${token}:channel`).setPlaceholder('Choose the panel channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (draft.channelId) channel.setDefaultChannels(draft.channelId);
    const role = new RoleSelectMenuBuilder().setCustomId(`rr:${token}:role`).setPlaceholder('Role to give when someone reacts');
    if (draft.roleId) role.setDefaultRoles(draft.roleId);
    const required = new RoleSelectMenuBuilder().setCustomId(`rr:${token}:required`).setPlaceholder('Optional: role needed to use this reaction').setMinValues(0);
    if (draft.requiredRoleId) required.setDefaultRoles(draft.requiredRoleId);
    return { content: null, embeds: [new EmbedBuilder().setTitle('Admin • Add Reaction Role').setColor(0x3498db)
      .setDescription(['Choose the channel and role. Set an emoji and optionally paste an existing message link.', 'Without a message link, Save creates and pins a new role panel.', note].filter(Boolean).join('\n\n'))
      .addFields({ name: 'Reaction', value: `${draft.emoji} → ${draft.roleId ? `<@&${draft.roleId}>` : 'Choose a role'}` }, { name: 'Target', value: draft.messageId ? `[Existing message](https://discord.com/channels/${draft.guildId}/${draft.channelId}/${draft.messageId})` : 'New role panel' }, { name: 'Required role', value: draft.requiredRoleId ? `<@&${draft.requiredRoleId}>` : 'Everyone can use the reaction' })],
      components: [row(channel), row(role), row(required), row(button(token, 'message', 'Emoji / message link'), button(token, 'save', draft.messageId ? 'Save binding' : 'Create panel', ButtonStyle.Primary)), row(button(token, 'browse-0', 'Existing bindings'), button(token, 'overview', 'Admin Overview'))], allowedMentions: { parse: [] } };
  }
  function browseView(token, guild, page = 0, note = '') {
    const session = sessions.get(token);
    const entries = store.getReactionRoleEntries(guild.id);
    page = Math.max(0, Math.min(Math.max(0, Math.ceil(entries.length / 8) - 1), page));
    const visible = entries.slice(page * 8, (page + 1) * 8);
    session.visible = visible.map(bindingKey);
    session.page = page;
    const embed = new EmbedBuilder().setTitle('Admin • Reaction Roles').setColor(0x3498db)
      .setDescription([note, visible.length ? visible.map((entry, index) => `${page * 8 + index + 1}. ${entry.emoji} → <@&${entry.roleId}> in <#${entry.channelId}>\n[Open message](https://discord.com/channels/${guild.id}/${entry.channelId}/${entry.messageId})${entry.requiredRoleId ? ` · Requires <@&${entry.requiredRoleId}>` : ''}`).join('\n\n') : 'No bindings yet. Choose Add binding to get started.'].filter(Boolean).join('\n\n'))
      .setFooter({ text: `Page ${page + 1}/${Math.max(1, Math.ceil(entries.length / 8))} • ${entries.length} bindings` });
    const components = [];
    if (visible.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`rr:${token}:select`).setPlaceholder('Select a binding to manage').addOptions(visible.map((entry, index) => ({ value: String(index), label: `${page * 8 + index + 1}. ${guild.roles.cache?.get(entry.roleId)?.name || entry.roleId} — ${entry.emoji}`.slice(0, 100), description: `#${guild.channels.cache?.get(entry.channelId)?.name || entry.channelId}`.slice(0, 100) })))));
    components.push(row(button(token, `browse-${page - 1}`, 'Previous', ButtonStyle.Secondary, page === 0), button(token, `browse-${page + 1}`, 'Next', ButtonStyle.Secondary, (page + 1) * 8 >= entries.length)), row(button(token, 'add', 'Add binding', ButtonStyle.Primary), button(token, 'overview', 'Admin Overview')));
    return { content: null, embeds: [embed], components, allowedMentions: { parse: [] } };
  }
  async function handle(interaction) {
    const entryPoint = ENTRY_POINT_IDS.includes(interaction.customId);
    if (!entryPoint && !interaction.customId?.startsWith('rr:')) return false;
    if (!(await accessControl.ensureServerAccess(interaction, 'reaction roles'))) return true;
    let token, action;
    if (entryPoint) {
      for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      if (sessions.size >= 500) sessions.delete(sessions.keys().next().value);
      token = randomBytes(8).toString('hex'); action = 'browse-0';
      sessions.set(token, { owner: interaction.user.id, guildId: interaction.guildId, expires: Date.now() + 30 * 60_000, emoji: '✅', channelId: null, roleId: null, requiredRoleId: null, messageId: null });
    } else [, token, action] = interaction.customId.split(':');
    const draft = sessions.get(token);
    if (!draft || draft.owner !== interaction.user.id || draft.guildId !== interaction.guildId || draft.expires < Date.now()) {
      await interaction.reply({ content: 'This editor expired or belongs to another user. Open Reaction Roles in /setup again.', flags: MessageFlags.Ephemeral }); return true;
    }
    if (action === 'overview') {
      await setupHub.showOverview(interaction); return true;
    }
    if (action.startsWith('browse-')) { await interaction.update(browseView(token, interaction.guild, Number(action.slice(7)) || 0)); return true; }
    if (action === 'add') { draft.selected = null; await interaction.update(draftView(token)); return true; }
    if (action === 'message') {
      await interaction.showModal(new ModalBuilder().setCustomId(`rr:${token}:details`).setTitle('Reaction details').addComponents(
        row(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(draft.emoji)),
        row(new TextInputBuilder().setCustomId('link').setLabel('Message link (empty = new panel)').setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.messageId ? `https://discord.com/channels/${draft.guildId}/${draft.channelId}/${draft.messageId}` : '')))); return true;
    }
    if (action === 'select') {
      const selected = draft.visible?.[Number(interaction.values[0])];
      const entry = store.getReactionRoleEntries(interaction.guildId).find(e => bindingKey(e) === selected);
      if (!entry) { await interaction.update(browseView(token, interaction.guild, draft.page, 'That binding was already removed.')); return true; }
      draft.selected = selected;
      await interaction.update({ content: null, embeds: [new EmbedBuilder().setTitle('Remove reaction binding?').setDescription(`${entry.emoji} → <@&${entry.roleId}> in <#${entry.channelId}>\n[Open message](https://discord.com/channels/${draft.guildId}/${entry.channelId}/${entry.messageId})\n\nThis stops assigning this role through this reaction. Existing member roles and the message are kept.`)], components: [row(button(token, 'delete', 'Remove binding', ButtonStyle.Danger), button(token, `browse-${draft.page}`, 'Cancel'))], allowedMentions: { parse: [] } }); return true;
    }
    await interaction.deferUpdate();
    if (working.has(token)) { await interaction.editReply(draftView(token, 'Another change is being saved. Try again shortly.')); return true; }
    working.add(token);
    let note = '';
    try {
      if (action === 'channel') { draft.channelId = interaction.values[0]; draft.messageId = null; }
      else if (action === 'role') draft.roleId = interaction.values[0];
      else if (action === 'required') draft.requiredRoleId = interaction.values[0] || null;
      else if (action === 'details') {
        const link = parseMessageLink(interaction.fields.getTextInputValue('link'), draft.guildId);
        const emoji = interaction.fields.getTextInputValue('emoji').trim();
        if (!emoji) throw new Error('Choose an emoji.');
        draft.emoji = emoji;
        draft.messageId = link?.messageId || null;
        if (link) draft.channelId = link.channelId;
      } else if (action === 'delete') {
        if (!draft.selected) throw new Error('Select a binding first.');
        const entry = store.getReactionRoleEntries(draft.guildId).find(e => bindingKey(e) === draft.selected);
        if (entry) await reactionRoles.removeReactionRoleEntry(interaction.guild, entry);
        draft.selected = null;
        await interaction.editReply(browseView(token, interaction.guild, draft.page, 'Binding removed.')); return true;
      } else if (action === 'save') {
        if (!draft.channelId || !draft.roleId) throw new Error('Select a channel and a role first.');
        const channel = await setupEditor.validateChannel(interaction.guild, draft.channelId);
        const role = await interaction.guild.roles.fetch(draft.roleId).catch(() => null);
        const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        const problem = getPanelRoleProblem(interaction.guild, role, store.getGuildConfig(draft.guildId).botManagers.roleIds);
        if (problem) throw new Error(`That role ${problem}. Choose a plain role below the bot in the role hierarchy.`);
        if (draft.requiredRoleId && !(await interaction.guild.roles.fetch(draft.requiredRoleId).catch(() => null))) throw new Error('The required role no longer exists.');
        if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles) || !channel.permissionsFor(me)?.has(PermissionsBitField.Flags.AddReactions)) throw new Error('The bot needs Manage Roles and Add Reactions.');
        let message = draft.messageId ? await channel.messages.fetch(draft.messageId).catch(() => null) : null;
        if (draft.messageId && !message) throw new Error('That message no longer exists or is not accessible to the bot.');
        const created = !message;
        if (!message) message = await channel.send({ embeds: [new EmbedBuilder().setTitle('Choose your role').setDescription(`React with ${draft.emoji} to receive <@&${draft.roleId}>.${draft.requiredRoleId ? `\nRequires <@&${draft.requiredRoleId}>.` : ''}\nRemove your reaction to remove the role.`)], allowedMentions: { parse: [] } });
        try { await reactionRoles.addReactionRoleBinding(draft.guildId, message, draft.roleId, draft.emoji, draft.requiredRoleId); }
        catch (error) { if (created) await message.delete().catch(() => null); throw error; }
        const warning = created ? await pinRolePanel(message) : null;
        draft.messageId = message.id;
        await interaction.editReply(browseView(token, interaction.guild, 0, ['Binding saved.', warning].filter(Boolean).join('\n'))); return true;
      } else throw new Error('Unknown action. Reopen the editor.');
    } catch (error) { note = error.message; }
    finally { working.delete(token); }
    await interaction.editReply(draftView(token, note));
    return true;
  }
  return { handle };
}
module.exports = { createReactionEditor, parseMessageLink };
