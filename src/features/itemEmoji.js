const { MessageFlags, PermissionsBitField } = require('discord.js');

function createItemEmojiFeature({ itemEmojis }) {
  async function handleItemEmojiCommand(interaction) {
    const customIdInput = interaction.options.getString('item', true);
    const enchanted = interaction.options.getBoolean('enchanted') || false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const resolved = await itemEmojis.resolveEmoji(customIdInput, { enchanted });
      if (!resolved) {
        await interaction.editReply({
          content: `No emoji mapping found for \`${itemEmojis.normalizeCustomId(customIdInput)}\`.`
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
      if (botMember && !interaction.channel.permissionsFor(botMember).has(PermissionsBitField.Flags.SendMessages)) {
        await interaction.editReply({
          content: 'I do not have permission to send messages in this channel.'
        });
        return;
      }

      await interaction.channel.send({
        content: `${resolved.formatted} \`${resolved.customId}\`\nData credit: Altpapier/Skyblock-Item-Emojis`
      });

      await interaction.editReply({
        content: `Posted the ${resolved.variant} emoji for \`${resolved.customId}\` in <#${interaction.channelId}>.`
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to resolve the SkyBlock item emoji.'
      });
    }
  }

  return {
    handleItemEmojiCommand
  };
}

module.exports = { createItemEmojiFeature };
