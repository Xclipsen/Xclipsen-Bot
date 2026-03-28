const { MessageFlags } = require('discord.js');

function createReactionRoleService({ client, store, ensureSetupAccess }) {
  function isSnowflake(value) {
    return /^\d{16,20}$/.test(String(value || '').trim());
  }

  function normalizeEmojiIdentifier(value) {
    const raw = String(value || '').trim();
    const customEmojiMatch = raw.match(/^<a?:[^:]+:(\d+)>$/);
    return customEmojiMatch ? customEmojiMatch[1] : raw;
  }

  function getReactionEmojiIdentifier(reaction) {
    return reaction.emoji.id || reaction.emoji.name || null;
  }

  async function fetchGuildMessage(channel, messageId) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      throw new Error('The message ID is invalid or not found in that channel.');
    }
    return message;
  }

  async function resolveReactionRoleInputs(guild, channelId, messageId, roleId = null, requiredRoleId = null) {
    if (!isSnowflake(channelId) || !isSnowflake(messageId) || (roleId && !isSnowflake(roleId)) || (requiredRoleId && !isSnowflake(requiredRoleId))) {
      throw new Error('Channel ID, message ID, role ID, and required role ID must be valid Discord snowflakes.');
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('The channel ID is invalid or not a text-based channel in this server.');
    }

    const message = await fetchGuildMessage(channel, messageId);
    const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
    const requiredRole = requiredRoleId ? await guild.roles.fetch(requiredRoleId).catch(() => null) : null;

    if (roleId && !role) {
      throw new Error('The role ID is invalid or not part of this server.');
    }

    if (requiredRoleId && !requiredRole) {
      throw new Error('The required role ID is invalid or not part of this server.');
    }

    return { channel, message, role, requiredRole };
  }

  async function addReactionRoleBinding(guildId, message, roleId, emojiInput, requiredRoleId = null) {
    const emoji = normalizeEmojiIdentifier(emojiInput);
    const existingEntries = store.getReactionRoleEntries(guildId);
    const duplicate = existingEntries.find((entry) => (
      entry.channelId === message.channelId &&
      entry.messageId === message.id &&
      entry.emoji === emoji
    ));

    if (duplicate) {
      throw new Error('That reaction role binding already exists for this message and emoji.');
    }

    await message.react(emojiInput).catch(() => null);
    store.setReactionRoleEntries(guildId, [
      ...existingEntries,
      {
        channelId: message.channelId,
        messageId: message.id,
        roleId,
        emoji,
        requiredRoleId
      }
    ]);
  }

  async function removeReactionRoleBinding(guildId, message, emojiInput) {
    const emoji = normalizeEmojiIdentifier(emojiInput);
    const existingEntries = store.getReactionRoleEntries(guildId);
    const nextEntries = existingEntries.filter((entry) => !(
      entry.channelId === message.channelId &&
      entry.messageId === message.id &&
      entry.emoji === emoji
    ));

    if (nextEntries.length === existingEntries.length) {
      throw new Error('No matching reaction role binding was found to remove.');
    }

    store.setReactionRoleEntries(guildId, nextEntries);
    await message.reactions.resolve(emoji)?.remove().catch(() => null);
  }

  function getReactionRoleSummaryLines(guildId) {
    return store.getReactionRoleEntries(guildId)
      .map((entry, index) => {
        const restriction = entry.requiredRoleId ? ` (requires <@&${entry.requiredRoleId}>)` : '';
        return `${index + 1}. ${entry.emoji} -> <@&${entry.roleId}> on ${entry.channelId}/${entry.messageId}${restriction}`;
      });
  }

  function buildReactionRoleSummary(guildId, options = {}) {
    const {
      maxLength = 1800,
      maxLines = Infinity
    } = options;

    const lines = getReactionRoleSummaryLines(guildId);
    if (lines.length === 0) {
      return 'No reaction roles configured yet.';
    }

    const output = [];
    let currentLength = 0;

    for (const line of lines) {
      if (output.length >= maxLines) {
        break;
      }

      const separatorLength = output.length > 0 ? 1 : 0;
      if ((currentLength + separatorLength + line.length) > maxLength) {
        break;
      }

      output.push(line);
      currentLength += separatorLength + line.length;
    }

    if (output.length < lines.length) {
      output.push(`... and ${lines.length - output.length} more binding(s).`);
    }

    return output.join('\n');
  }

  function purgeReactionRoleBindings(guildId, options = {}) {
    const existingEntries = store.getReactionRoleEntries(guildId);
    const nextEntries = existingEntries.filter((entry) => {
      if (options.channelId && entry.channelId !== options.channelId) {
        return true;
      }

      if (options.messageId && entry.messageId !== options.messageId) {
        return true;
      }

      return false;
    });

    const removedCount = existingEntries.length - nextEntries.length;
    if (removedCount === 0) {
      return 0;
    }

    store.setReactionRoleEntries(guildId, nextEntries);
    return removedCount;
  }

  async function handleReactionRoleCommand(interaction) {
    if (!(await ensureSetupAccess(interaction, 'reaction role command'))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'list') {
      await interaction.reply({
        content: buildReactionRoleSummary(interaction.guildId, { maxLength: 1900 }),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === 'purge') {
      const channel = interaction.options.getChannel('channel');
      const messageId = interaction.options.getString('message_id')?.trim() || null;

      if (messageId && !channel) {
        await interaction.reply({
          content: 'Set a channel when you want to purge bindings for a specific message.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (messageId && !isSnowflake(messageId)) {
        await interaction.reply({
          content: 'Message ID must be a valid Discord snowflake.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const removedCount = purgeReactionRoleBindings(interaction.guildId, {
        channelId: channel?.id || null,
        messageId
      });

      const scope = messageId
        ? `message \`${messageId}\` in <#${channel.id}>`
        : channel
          ? `channel <#${channel.id}>`
          : 'this server';

      await interaction.reply({
        content: removedCount > 0
          ? `Purged ${removedCount} reaction role binding(s) from ${scope}.`
          : `No reaction role bindings found for ${scope}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const messageId = interaction.options.getString('message_id', true).trim();
    const emojiInput = interaction.options.getString('emoji', true);

    if (!channel.isTextBased()) {
      await interaction.reply({
        content: 'The selected channel must be text-based.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!isSnowflake(messageId)) {
      await interaction.reply({
        content: 'Message ID must be a valid Discord snowflake.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const role = subcommand === 'add' ? interaction.options.getRole('role', true) : null;
    const requiredRole = subcommand === 'add' ? interaction.options.getRole('required_role') : null;
    const resolved = await resolveReactionRoleInputs(interaction.guild, channel.id, messageId, role?.id || null, requiredRole?.id || null).catch((error) => error);

    if (resolved instanceof Error) {
      await interaction.reply({
        content: resolved.message,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { message } = resolved;

    if (subcommand === 'add') {
      const result = await addReactionRoleBinding(interaction.guildId, message, role.id, emojiInput, requiredRole?.id || null).catch((error) => error);
      if (result instanceof Error) {
        await interaction.reply({
          content: result.message,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const content = requiredRole
        ? `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${message.url}) and requires <@&${requiredRole.id}>.`
        : `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${message.url}).`;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    const result = await removeReactionRoleBinding(interaction.guildId, message, emojiInput).catch((error) => error);
    if (result instanceof Error) {
      await interaction.reply({
        content: result.message,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      content: `Removed reaction role binding for ${emojiInput} on [this message](${message.url}).`,
      flags: MessageFlags.Ephemeral
    });
  }

  async function resolveReactionContext(reaction) {
    if (reaction.partial) {
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      await reaction.message.fetch();
    }
    return reaction.message;
  }

  async function applyReactionRoleChange(reaction, user, shouldAdd) {
    if (user.bot) {
      return;
    }

    const message = await resolveReactionContext(reaction).catch(() => null);
    if (!message?.guildId) {
      return;
    }

    const emoji = getReactionEmojiIdentifier(reaction);
    if (!emoji) {
      return;
    }

    const reactionRole = store.getReactionRoleEntries(message.guildId).find((entry) => (
      entry.channelId === message.channelId &&
      entry.messageId === message.id &&
      entry.emoji === emoji
    ));

    if (!reactionRole) {
      return;
    }

    const guild = message.guild || await client.guilds.fetch(message.guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return;
    }

    if (shouldAdd && reactionRole.requiredRoleId && !member.roles.cache.has(reactionRole.requiredRoleId)) {
      await reaction.users.remove(user.id).catch((error) => {
        console.error(`Failed to remove unauthorized reaction ${reactionRole.emoji} from ${user.id} in guild ${guild.id}:`, error);
      });
      return;
    }

    if (shouldAdd) {
      await member.roles.add(reactionRole.roleId).catch((error) => {
        console.error(`Failed to add role ${reactionRole.roleId} to ${user.id}:`, error);
      });
      return;
    }

    await member.roles.remove(reactionRole.roleId).catch((error) => {
      console.error(`Failed to remove role ${reactionRole.roleId} from ${user.id}:`, error);
    });
  }

  return {
    buildReactionRoleSummary,
    handleReactionRoleCommand,
    resolveReactionRoleInputs,
    addReactionRoleBinding,
    removeReactionRoleBinding,
    purgeReactionRoleBindings,
    applyReactionRoleChange
  };
}

module.exports = { createReactionRoleService };
