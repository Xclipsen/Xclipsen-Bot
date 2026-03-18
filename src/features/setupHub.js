const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

function createSetupHub({ store, ensureSetupAccess, mayorAlerts, reactionRoles, interactionIds }) {
  const {
    SETUP_MODAL_ID,
    SETUP_VIEW_HOME_ID,
    SETUP_VIEW_DISCORD_ID,
    SETUP_VIEW_MAYOR_ID,
    SETUP_MAYOR_RELOAD_ID,
    SETUP_VIEW_REACTION_ROLES_ID,
    SETUP_REACTION_ADD_MODAL_ID,
    SETUP_REACTION_REMOVE_MODAL_ID,
    SETUP_REACTION_CHANNEL_INPUT_ID,
    SETUP_REACTION_MESSAGE_INPUT_ID,
    SETUP_REACTION_ROLE_INPUT_ID,
    SETUP_REACTION_EMOJI_INPUT_ID,
    SETUP_REACTION_REQUIRED_ROLE_INPUT_ID,
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

  function isSnowflake(value) {
    return /^\d{16,20}$/.test(String(value || '').trim());
  }

  async function validateMayorSetupInputs(guild, channelId, roleId) {
    if (!isSnowflake(channelId) || !isSnowflake(roleId)) {
      throw new Error('Channel ID and Role ID must be valid Discord snowflakes.');
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('The channel ID is invalid or not a text-based channel in this server.');
    }

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      throw new Error('The role ID is invalid or not part of this server.');
    }

    return { channel, role };
  }

  function createDiscordSetupEmbed(guild, note = null) {
    const config = store.getGuildConfig(guild.id);
    const description = [
      'This section groups the current Discord-side bot configuration.',
      'Open Mayor Alerts to change the status/alert channel and ping role.',
      'Open Reaction Roles to manage message-based role toggles.'
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
        { name: 'Reaction Roles', value: `${config.reactionRoles.length} binding(s) configured`, inline: false }
      )
      .setFooter({ text: 'Pick a Discord settings category.' });
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
        new ButtonBuilder().setCustomId(SETUP_MAYOR_RELOAD_ID).setLabel('Reload Status').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(SETUP_VIEW_REACTION_ROLES_ID).setLabel('Reaction Roles').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_HOME_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
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

  async function handleSetupCommand(interaction) {
    if (!(await ensureSetupAccess(interaction, 'command'))) {
      return;
    }

    await interaction.reply({
      embeds: [createSetupHubEmbed(interaction.guild)],
      components: createSetupComponents(),
      flags: MessageFlags.Ephemeral
    });
  }

  async function updateSetupView(interaction, embed, components) {
    await interaction.update({ embeds: [embed], components });
  }

  async function handleSetupNavigationButton(interaction) {
    if (!(await ensureSetupAccess(interaction, 'setup panel'))) {
      return;
    }

    if (interaction.customId === SETUP_VIEW_HOME_ID) {
      await updateSetupView(interaction, createSetupHubEmbed(interaction.guild), createSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_DISCORD_ID) {
      await updateSetupView(interaction, createDiscordSetupEmbed(interaction.guild), createDiscordSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_MAYOR_ID) {
      await interaction.showModal(createMayorSetupModal(store.getGuildConfig(interaction.guildId)));
      return;
    }

    if (interaction.customId === SETUP_MAYOR_RELOAD_ID) {
      await interaction.deferUpdate();

      let note;

      try {
        const data = await mayorAlerts.fetchElectionData();
        const mayor = data.mayor;
        const boothOpen = mayorAlerts.getBoothOpen(data);

        await mayorAlerts.sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen);
        store.setGuildRuntimeState(interaction.guildId, {
          ...store.getGuildRuntimeState(interaction.guildId),
          boothOpen
        });

        note = `Reloaded the mayor status for ${mayor.name}.`;
      } catch (error) {
        console.error(`Failed to reload mayor status for guild ${interaction.guildId}:`, error);
        note = 'Mayor status reload failed. Check the bot logs and channel access.';
      }

      await interaction.editReply({
        embeds: [createDiscordSetupEmbed(interaction.guild, note)],
        components: createDiscordSetupComponents()
      });
      return;
    }

    if (interaction.customId === SETUP_VIEW_REACTION_ROLES_ID) {
      await updateSetupView(interaction, createReactionRoleSetupEmbed(interaction.guild), createReactionRoleSetupComponents());
    }
  }

  async function handleSetupActionButton(interaction) {
    if (!(await ensureSetupAccess(interaction, 'setup button'))) {
      return;
    }

    if (interaction.customId === SETUP_REACTION_ADD_MODAL_ID) {
      await interaction.showModal(createReactionRoleAddModal());
      return;
    }

    if (interaction.customId === SETUP_REACTION_REMOVE_MODAL_ID) {
      await interaction.showModal(createReactionRoleRemoveModal());
    }
  }

  async function handleMayorSetupModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'setup form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = interaction.fields.getTextInputValue(SETUP_CHANNEL_INPUT_ID).trim();
    const roleId = interaction.fields.getTextInputValue(SETUP_ROLE_INPUT_ID).trim();

    const validationResult = await validateMayorSetupInputs(interaction.guild, channelId, roleId).catch((error) => error);
    if (validationResult instanceof Error) {
      await interaction.editReply({ content: validationResult.message });
      return;
    }

    store.setGuildConfig(interaction.guildId, { channelId, roleId });
    store.setGuildRuntimeState(interaction.guildId, { statusMessageId: null, statusChannelId: null });

    let setupNote = 'Setup saved successfully.';
    try {
      const data = await mayorAlerts.fetchElectionData();
      const mayor = data.mayor;
      const boothOpen = mayorAlerts.getBoothOpen(data);
      await mayorAlerts.sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen);
      store.setGuildRuntimeState(interaction.guildId, { ...store.getGuildRuntimeState(interaction.guildId), boothOpen });
      setupNote = `Setup saved successfully. Posted the current mayor status for ${mayor.name}.`;
    } catch (error) {
      console.error(`Failed to send immediate status update for guild ${interaction.guildId}:`, error);
      setupNote = 'Setup saved successfully, but the current mayor status could not be posted yet.';
    }

    await interaction.editReply({
      embeds: [createDiscordSetupEmbed(interaction.guild, setupNote)],
      components: createDiscordSetupComponents(),
      content: null
    });
  }

  async function handleReactionRoleModalSubmit(interaction, mode) {
    if (!(await ensureSetupAccess(interaction, 'reaction role form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = interaction.fields.getTextInputValue(SETUP_REACTION_CHANNEL_INPUT_ID).trim();
    const messageId = interaction.fields.getTextInputValue(SETUP_REACTION_MESSAGE_INPUT_ID).trim();
    const emojiInput = interaction.fields.getTextInputValue(SETUP_REACTION_EMOJI_INPUT_ID).trim();
    const roleId = mode === 'add' ? interaction.fields.getTextInputValue(SETUP_REACTION_ROLE_INPUT_ID).trim() : null;
    const requiredRoleId = mode === 'add'
      ? interaction.fields.getTextInputValue(SETUP_REACTION_REQUIRED_ROLE_INPUT_ID).trim() || null
      : null;

    const resolved = await reactionRoles
      .resolveReactionRoleInputs(interaction.guild, channelId, messageId, roleId, requiredRoleId)
      .catch((error) => error);
    if (resolved instanceof Error) {
      await interaction.editReply({ content: resolved.message });
      return;
    }

    const { message, role, requiredRole } = resolved;
    const result = mode === 'add'
      ? await reactionRoles
        .addReactionRoleBinding(interaction.guildId, message, role.id, emojiInput, requiredRole?.id || null)
        .catch((error) => error)
      : await reactionRoles.removeReactionRoleBinding(interaction.guildId, message, emojiInput).catch((error) => error);

    if (result instanceof Error) {
      await interaction.editReply({ content: result.message });
      return;
    }

    const note = mode === 'add'
      ? (requiredRole
        ? `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${message.url}) and requires <@&${requiredRole.id}>.`
        : `Saved reaction role: ${emojiInput} gives <@&${role.id}> on [this message](${message.url}).`)
      : `Removed reaction role binding for ${emojiInput} on [this message](${message.url}).`;

    await interaction.editReply({
      embeds: [createReactionRoleSetupEmbed(interaction.guild, note)],
      components: createReactionRoleSetupComponents(),
      content: null
    });
  }

  return {
    handleSetupCommand,
    handleSetupNavigationButton,
    handleSetupActionButton,
    handleMayorSetupModalSubmit,
    handleReactionRoleModalSubmit,
    ids: interactionIds
  };
}

module.exports = { createSetupHub };
