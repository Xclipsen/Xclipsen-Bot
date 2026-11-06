const { MessageFlags, PermissionsBitField } = require('discord.js');

function createAccessControl(privilegedUserIds, store) {
  function hasManageGuildPermission(interaction) {
    return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) === true;
  }

  function isPrivilegedUser(interaction) {
    return privilegedUserIds.has(String(interaction.user?.id || ''));
  }

  function isBotManager(interaction) {
    if (!interaction.guildId || !store) return false;
    const managers = store.getGuildConfig(interaction.guildId).botManagers;
    const memberRoles = interaction.member?.roles;
    const ids = Array.isArray(memberRoles) ? memberRoles : [...(memberRoles?.cache?.keys() || [])];
    return managers.userIds.includes(String(interaction.user?.id)) || managers.roleIds.some(id => ids.includes(id));
  }

  // Server managers, privileged bot users and (optionally) delegated bot managers.
  function hasAccess(interaction, allowManagers = true) {
    return hasManageGuildPermission(interaction) || isPrivilegedUser(interaction) || (allowManagers && isBotManager(interaction));
  }

  async function ensureAccess(interaction, sourceLabel, allowManagers) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: `This ${sourceLabel} can only be used inside a server.`,
        flags: MessageFlags.Ephemeral
      });
      return false;
    }

    if (!hasAccess(interaction, allowManagers)) {
      await interaction.reply({
        content: allowManagers ? 'Ask a server administrator to add you under Bot Access, or use Manage Server permission.' : 'Only server administrators or privileged bot users can change access and reaction roles.',
        flags: MessageFlags.Ephemeral
      });
      return false;
    }

    return true;
  }

  const ensureSetupAccess = (interaction, sourceLabel) => ensureAccess(interaction, sourceLabel, true);
  const ensureServerAccess = (interaction, sourceLabel) => ensureAccess(interaction, sourceLabel, false);
  return { isBotManager, hasAccess, ensureSetupAccess, ensureServerAccess };
}

module.exports = { createAccessControl };
