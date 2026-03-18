const { MessageFlags, PermissionsBitField } = require('discord.js');

function createAccessControl(privilegedUserIds) {
  function hasManageGuildPermission(interaction) {
    return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) === true;
  }

  function isPrivilegedUser(interaction) {
    return privilegedUserIds.has(String(interaction.user?.id || ''));
  }

  async function ensureSetupAccess(interaction, sourceLabel) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: `This ${sourceLabel} can only be used inside a server.`,
        flags: MessageFlags.Ephemeral
      });
      return false;
    }

    if (!hasManageGuildPermission(interaction) && !isPrivilegedUser(interaction)) {
      await interaction.reply({
        content: 'You need the Manage Server permission or privileged bot access to configure this bot.',
        flags: MessageFlags.Ephemeral
      });
      return false;
    }

    return true;
  }

  return { hasManageGuildPermission, isPrivilegedUser, ensureSetupAccess };
}

module.exports = { createAccessControl };
