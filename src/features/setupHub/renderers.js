const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

function createSetupHubRenderers({ store, reactionRoles, interactionIds }) {
  const {
    SETUP_MODAL_ID,
    SETUP_VIEW_HOME_ID,
    SETUP_VIEW_DISCORD_ID,
    SETUP_VIEW_MAYOR_ID,
    SETUP_MAYOR_EDIT_ID,
    SETUP_MAYOR_RELOAD_ID,
    SETUP_MAYOR_RESET_ID,
    SETUP_VIEW_REACTION_ROLES_ID,
    SETUP_VIEW_SHITTER_ID,
    SETUP_REACTION_ADD_MODAL_ID,
    SETUP_REACTION_REMOVE_MODAL_ID,
    SETUP_SHITTER_MODAL_ID,
    SETUP_REACTION_CHANNEL_INPUT_ID,
    SETUP_REACTION_MESSAGE_INPUT_ID,
    SETUP_REACTION_ROLE_INPUT_ID,
    SETUP_REACTION_EMOJI_INPUT_ID,
    SETUP_REACTION_REQUIRED_ROLE_INPUT_ID,
    SETUP_SHITTER_BLOCKED_USERS_INPUT_ID,
    SETUP_SHITTER_BLOCKED_ROLES_INPUT_ID,
    SETUP_SHITTER_ALLOWED_ROLES_INPUT_ID,
    SETUP_CHANNEL_INPUT_ID,
    SETUP_ROLE_INPUT_ID
  } = interactionIds;

  function createSetupHubEmbed(guild, note = null) {
    const description = [
      'Choose a category to manage server-specific bot settings.',
      'Discord contains the current mayor alerts and reaction role tools.',
      'Additional sections can be added here later without changing the command flow.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Discord', value: 'Mayor alerts, current status posting, and reaction role management.', inline: false },
        { name: 'Automation', value: 'Reserved for future tools and workflows.', inline: true },
        { name: 'More Coming Soon', value: 'Use this hub as the central place for new bot modules later on.', inline: true }
      )
      .setFooter({ text: 'Use the buttons below to navigate.' });
  }

  function createDiscordSetupEmbed(guild, note = null) {
    const config = store.getGuildConfig(guild.id);
    const description = [
      'This section groups the current Discord-side bot configuration.',
      'Open Mayor Alerts to change the status/alert channel and ping role.',
      'Open Reaction Roles to manage message-based role toggles.',
      'Open Shitter List to control who can add or remove shitter entries.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Mayor Alerts', value: `Channel: ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}\nRole: ${config.roleId ? `<@&${config.roleId}>` : 'Not configured'}`, inline: false },
        { name: 'Reaction Roles', value: `${config.reactionRoles.length} binding(s) configured`, inline: false },
        {
          name: 'Shitter List Permissions',
          value: `Blocked users: ${config.shitterPermissions.blockedUserIds.length}\nBlocked roles: ${config.shitterPermissions.blockedRoleIds.length}\nAllowed roles: ${config.shitterPermissions.allowedRoleIds.length || 'Everyone'}`,
          inline: false
        }
      )
      .setFooter({ text: 'Pick a Discord settings category.' });
  }

  function formatMentionList(values, type) {
    if (values.length === 0) {
      return 'None';
    }

    return values.map((value) => (type === 'user' ? `<@${value}>` : `<@&${value}>`)).join(', ');
  }

  function createShitterSetupEmbed(guild, note = null) {
    const permissions = store.getGuildConfig(guild.id).shitterPermissions;
    const description = [
      'Control who is blocked from adding or removing shitter entries and which roles are allowed to manage them.',
      'If allowed roles stay empty, everyone can manage entries unless blocked by user ID or role ID.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord - Shitter List')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Blocked Users', value: formatMentionList(permissions.blockedUserIds, 'user'), inline: false },
        { name: 'Blocked Roles', value: formatMentionList(permissions.blockedRoleIds, 'role'), inline: false },
        { name: 'Allowed Roles', value: permissions.allowedRoleIds.length ? formatMentionList(permissions.allowedRoleIds, 'role') : 'Everyone', inline: false }
      )
      .setFooter({ text: 'Use the button below to edit comma-separated Discord IDs.' });
  }

  function createReactionRoleSetupEmbed(guild, note = null) {
    const description = [
      'Create or remove reaction role bindings directly from this panel.',
      'You will enter a channel ID, message ID, role ID, and emoji in the modal.',
      'Optional required roles can restrict who is allowed to claim a role via reaction.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord - Reaction Roles')
      .setDescription(description.join('\n'))
      .addFields({ name: 'Current Bindings', value: reactionRoles.buildReactionRoleSummary(guild.id), inline: false })
      .setFooter({ text: 'Add or remove bindings with the buttons below.' });
  }

  function createMayorSetupEmbed(guild, note = null) {
    const config = store.getGuildConfig(guild.id);
    const description = [
      'Manage mayor alert posting for this server.',
      'You can change the target channel, ping role, force a fresh status reload, or reset old mayor messages from here.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord - Mayor Alerts')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Status Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not configured', inline: true },
        { name: 'Ping Role', value: config.roleId ? `<@&${config.roleId}>` : 'Not configured', inline: true }
      )
      .setFooter({ text: 'Edit the config or reload the live mayor status.' });
  }

  function createSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Discord').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup-placeholder-automation').setLabel('Automation').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('setup-placeholder-more').setLabel('More Soon').setStyle(ButtonStyle.Secondary).setDisabled(true)
      )
    ];
  }

  function createDiscordSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_MAYOR_ID).setLabel('Mayor Alerts').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_VIEW_REACTION_ROLES_ID).setLabel('Reaction Roles').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(SETUP_VIEW_SHITTER_ID).setLabel('Shitter List').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_HOME_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createShitterSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_SHITTER_MODAL_ID).setLabel('Edit Permissions').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createMayorSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_MAYOR_EDIT_ID).setLabel('Edit Config').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_MAYOR_RELOAD_ID).setLabel('Reload Status').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(SETUP_MAYOR_RESET_ID).setLabel('Reset Messages').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createReactionRoleSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_REACTION_ADD_MODAL_ID).setLabel('Add Binding').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_REACTION_REMOVE_MODAL_ID).setLabel('Remove Binding').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createMayorSetupModal(existingConfig) {
    return new ModalBuilder()
      .setCustomId(SETUP_MODAL_ID)
      .setTitle('Mayor Alerts')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_CHANNEL_INPUT_ID).setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(existingConfig.channelId || '').setPlaceholder('1093242679493664768')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_ROLE_INPUT_ID).setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(existingConfig.roleId || '').setPlaceholder('1483819173447733419'))
      );
  }

  function createReactionRoleAddModal() {
    return new ModalBuilder()
      .setCustomId(SETUP_REACTION_ADD_MODAL_ID)
      .setTitle('Add Reaction Role')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_CHANNEL_INPUT_ID).setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_MESSAGE_INPUT_ID).setLabel('Message ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_ROLE_INPUT_ID).setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_EMOJI_INPUT_ID).setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('✅ or <:diaz:123456789012345678>')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_REQUIRED_ROLE_INPUT_ID).setLabel('Required Role ID (optional)').setStyle(TextInputStyle.Short).setRequired(false))
      );
  }

  function createReactionRoleRemoveModal() {
    return new ModalBuilder()
      .setCustomId(SETUP_REACTION_REMOVE_MODAL_ID)
      .setTitle('Remove Reaction Role')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_CHANNEL_INPUT_ID).setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_MESSAGE_INPUT_ID).setLabel('Message ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_REACTION_EMOJI_INPUT_ID).setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(true))
      );
  }

  function createShitterSetupModal(existingPermissions) {
    return new ModalBuilder()
      .setCustomId(SETUP_SHITTER_MODAL_ID)
      .setTitle('Shitter List Permissions')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_SHITTER_BLOCKED_USERS_INPUT_ID)
            .setLabel('Blocked user IDs')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(existingPermissions.blockedUserIds.join(', '))
            .setPlaceholder('123..., 456...')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_SHITTER_BLOCKED_ROLES_INPUT_ID)
            .setLabel('Blocked role IDs')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(existingPermissions.blockedRoleIds.join(', '))
            .setPlaceholder('123..., 456...')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_SHITTER_ALLOWED_ROLES_INPUT_ID)
            .setLabel('Allowed role IDs')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(existingPermissions.allowedRoleIds.join(', '))
            .setPlaceholder('Leave empty to allow everyone')
        )
      );
  }

  return {
    createSetupHubEmbed,
    createDiscordSetupEmbed,
    createShitterSetupEmbed,
    createReactionRoleSetupEmbed,
    createMayorSetupEmbed,
    createSetupComponents,
    createDiscordSetupComponents,
    createMayorSetupComponents,
    createShitterSetupComponents,
    createReactionRoleSetupComponents,
    createMayorSetupModal,
    createReactionRoleAddModal,
    createReactionRoleRemoveModal,
    createShitterSetupModal
  };
}

module.exports = { createSetupHubRenderers };
