const { AttachmentBuilder, MessageFlags, PermissionsBitField } = require('discord.js');

function createItemEmojiFeature({ itemEmojis }) {
  async function handleItemEmojiAutocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();

    try {
      const suggestions = await itemEmojis.suggestCustomIds(focusedValue, { limit: 25 });
      await interaction.respond(suggestions.map((customId) => ({
        name: customId,
        value: customId
      })));
    } catch (error) {
      await interaction.respond([]).catch(() => null);
    }
  }

  async function handleItemEmojiCommand(interaction) {
    const customIdInput = interaction.options.getString('item', true);
    const enchanted = interaction.options.getBoolean('enchanted') || false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const resolved = await itemEmojis.resolveEmoji(customIdInput, { enchanted });
      if (!resolved) {
        const suggestions = await itemEmojis.suggestCustomIds(customIdInput, { limit: 5 });
        await interaction.editReply({
          content: suggestions.length > 0
            ? `No emoji mapping found for \`${itemEmojis.normalizeCustomId(customIdInput)}\`.\nDid you mean: ${suggestions.map((entry) => `\`${entry}\``).join(', ')}`
            : `No emoji mapping found for \`${itemEmojis.normalizeCustomId(customIdInput)}\`.`
        });
        return;
      }

      if (!interaction.channel || typeof interaction.channel.send !== 'function') {
        await interaction.editReply({
          content: 'This command can only be used in a server text channel.'
        });
        return;
      }

      const botMember = interaction.guild?.members?.me || null;
      const channelPermissions = botMember ? interaction.channel.permissionsFor(botMember) : null;
      if (channelPermissions && !channelPermissions.has(PermissionsBitField.Flags.SendMessages)) {
        await interaction.editReply({
          content: 'I do not have permission to send messages in this channel.'
        });
        return;
      }

      if (channelPermissions && !channelPermissions.has(PermissionsBitField.Flags.AttachFiles)) {
        await interaction.editReply({
          content: 'I do not have permission to attach files in this channel.'
        });
        return;
      }

      const emojiResponse = await fetch(resolved.cdnUrl, {
        headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' }
      });
      if (!emojiResponse.ok) {
        throw new Error(`Failed to download the item emoji image (${emojiResponse.status}).`);
      }

      const emojiBuffer = Buffer.from(await emojiResponse.arrayBuffer());
      const fileName = `${resolved.customId.toLowerCase()}-${resolved.variant}.${resolved.fileExtension}`;

      await interaction.channel.send({
        content: `\`${resolved.customId}\`${resolved.variant === 'enchanted' ? ' (enchanted)' : ''}\nData credit: Altpapier/Skyblock-Item-Emojis`,
        files: [new AttachmentBuilder(emojiBuffer, { name: fileName })]
      });

      await interaction.editReply({
        content: `Posted the ${resolved.variant} item emoji image for \`${resolved.customId}\` in <#${interaction.channelId}>.`
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to resolve the SkyBlock item emoji.'
      });
    }
  }

  return {
    handleItemEmojiAutocomplete,
    handleItemEmojiCommand
  };
}

module.exports = { createItemEmojiFeature };
