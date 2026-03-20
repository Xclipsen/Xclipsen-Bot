const { MessageFlags } = require('discord.js');

const { createSetupHubRenderers } = require('./renderers');

function createSetupHub({ store, ensureSetupAccess, mayorAlerts, reactionRoles, interactionIds }) {
  const renderers = createSetupHubRenderers({ store, reactionRoles, interactionIds });
  const {
    SETUP_VIEW_HOME_ID,
    SETUP_VIEW_DISCORD_ID,
    SETUP_VIEW_PLAYER_TOOLS_ID,
    SETUP_VIEW_MAYOR_ID,
    SETUP_MAYOR_EDIT_ID,
    SETUP_MAYOR_TOGGLE_ELECTION_PING_ID,
    SETUP_MAYOR_TOGGLE_CHANGE_PING_ID,
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

  function parseSnowflakeList(rawValue) {
    const values = String(rawValue || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const invalidValue = values.find((value) => !isSnowflake(value));
    if (invalidValue) {
      throw new Error(`Invalid Discord ID: ${invalidValue}`);
    }

    return [...new Set(values)];
  }

  async function handleSetupCommand(interaction) {
    if (!(await ensureSetupAccess(interaction, 'command'))) {
      return;
    }

    await interaction.reply({
      embeds: [renderers.createSetupHubEmbed(interaction.guild)],
      components: renderers.createSetupComponents(),
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
      await updateSetupView(interaction, renderers.createSetupHubEmbed(interaction.guild), renderers.createSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_DISCORD_ID) {
      await updateSetupView(interaction, renderers.createDiscordSetupEmbed(interaction.guild), renderers.createDiscordSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_PLAYER_TOOLS_ID) {
      await updateSetupView(interaction, renderers.createPlayerToolsEmbed(interaction.guild), renderers.createPlayerToolsComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_MAYOR_ID) {
      await updateSetupView(interaction, renderers.createMayorSetupEmbed(interaction.guild), renderers.createMayorSetupComponents(interaction.guild));
      return;
    }

    if (interaction.customId === SETUP_MAYOR_RELOAD_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        const data = await mayorAlerts.fetchElectionData();
        const mayor = data.mayor;
        const currentElection = data.current || null;
        const boothOpen = mayorAlerts.getBoothOpen(data);

        await mayorAlerts.sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen, currentElection);
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
        embeds: [renderers.createMayorSetupEmbed(interaction.guild, note)],
        components: renderers.createMayorSetupComponents(interaction.guild)
      });
      return;
    }

    if (interaction.customId === SETUP_VIEW_REACTION_ROLES_ID) {
      await updateSetupView(interaction, renderers.createReactionRoleSetupEmbed(interaction.guild), renderers.createReactionRoleSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_SHITTER_ID) {
      await updateSetupView(interaction, renderers.createShitterSetupEmbed(interaction.guild), renderers.createShitterSetupComponents());
    }
  }

  async function handleSetupActionButton(interaction) {
    if (!(await ensureSetupAccess(interaction, 'setup button'))) {
      return;
    }

    if (interaction.customId === SETUP_REACTION_ADD_MODAL_ID) {
      await interaction.showModal(renderers.createReactionRoleAddModal());
      return;
    }

    if (interaction.customId === SETUP_MAYOR_EDIT_ID) {
      await interaction.showModal(renderers.createMayorSetupModal(store.getGuildConfig(interaction.guildId)));
      return;
    }

    if (
      interaction.customId === SETUP_MAYOR_TOGGLE_ELECTION_PING_ID ||
      interaction.customId === SETUP_MAYOR_TOGGLE_CHANGE_PING_ID
    ) {
      const config = store.getGuildConfig(interaction.guildId);
      const nextMayorAlerts = {
        ...config.mayorAlerts,
        ...(interaction.customId === SETUP_MAYOR_TOGGLE_ELECTION_PING_ID
          ? { pingElectionOpen: !config.mayorAlerts.pingElectionOpen }
          : { pingMayorChange: !config.mayorAlerts.pingMayorChange })
      };

      store.setGuildConfig(interaction.guildId, { mayorAlerts: nextMayorAlerts });

      const note = interaction.customId === SETUP_MAYOR_TOGGLE_ELECTION_PING_ID
        ? `Election booth pings are now ${nextMayorAlerts.pingElectionOpen ? 'enabled' : 'disabled'}.`
        : `Mayor change pings are now ${nextMayorAlerts.pingMayorChange ? 'enabled' : 'disabled'}.`;

      await interaction.update({
        embeds: [renderers.createMayorSetupEmbed(interaction.guild, note)],
        components: renderers.createMayorSetupComponents(interaction.guild)
      });
      return;
    }

    if (interaction.customId === SETUP_MAYOR_RESET_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        const result = await mayorAlerts.resetMayorMessages(interaction.guildId);
        note = `Removed old mayor bot messages and reposted the current status for ${result.mayor.name}.`;
      } catch (error) {
        console.error(`Failed to reset mayor messages for guild ${interaction.guildId}:`, error);
        note = 'Mayor message reset failed. Check the bot logs and channel access.';
      }

      await interaction.editReply({
        embeds: [renderers.createMayorSetupEmbed(interaction.guild, note)],
        components: renderers.createMayorSetupComponents(interaction.guild)
      });
      return;
    }

    if (interaction.customId === SETUP_REACTION_REMOVE_MODAL_ID) {
      await interaction.showModal(renderers.createReactionRoleRemoveModal());
      return;
    }

    if (interaction.customId === SETUP_SHITTER_MODAL_ID) {
      await interaction.showModal(renderers.createShitterSetupModal(store.getGuildConfig(interaction.guildId).shitterPermissions));
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
      const currentElection = data.current || null;
      const boothOpen = mayorAlerts.getBoothOpen(data);
      await mayorAlerts.sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen, currentElection);
      store.setGuildRuntimeState(interaction.guildId, { ...store.getGuildRuntimeState(interaction.guildId), boothOpen });
      setupNote = `Setup saved successfully. Posted the current mayor status for ${mayor.name}.`;
    } catch (error) {
      console.error(`Failed to send immediate status update for guild ${interaction.guildId}:`, error);
      setupNote = 'Setup saved successfully, but the current mayor status could not be posted yet.';
    }

    await interaction.editReply({
      embeds: [renderers.createMayorSetupEmbed(interaction.guild, setupNote)],
      components: renderers.createMayorSetupComponents(interaction.guild),
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
      embeds: [renderers.createReactionRoleSetupEmbed(interaction.guild, note)],
      components: renderers.createReactionRoleSetupComponents(),
      content: null
    });
  }

  async function handleShitterSetupModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'shitter setup form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let blockedUserIds;
    let blockedRoleIds;
    let allowedRoleIds;

    try {
      blockedUserIds = parseSnowflakeList(interaction.fields.getTextInputValue(SETUP_SHITTER_BLOCKED_USERS_INPUT_ID));
      blockedRoleIds = parseSnowflakeList(interaction.fields.getTextInputValue(SETUP_SHITTER_BLOCKED_ROLES_INPUT_ID));
      allowedRoleIds = parseSnowflakeList(interaction.fields.getTextInputValue(SETUP_SHITTER_ALLOWED_ROLES_INPUT_ID));
    } catch (error) {
      await interaction.editReply({ content: error.message });
      return;
    }

    store.setGuildConfig(interaction.guildId, {
      shitterPermissions: {
        blockedUserIds,
        blockedRoleIds,
        allowedRoleIds
      }
    });

    await interaction.editReply({
      embeds: [renderers.createShitterSetupEmbed(interaction.guild, 'Shitter permissions saved successfully.')],
      components: renderers.createShitterSetupComponents(),
      content: null,
      allowedMentions: { parse: [] }
    });
  }

  return {
    handleSetupCommand,
    handleSetupNavigationButton,
    handleSetupActionButton,
    handleMayorSetupModalSubmit,
    handleReactionRoleModalSubmit,
    handleShitterSetupModalSubmit,
    ids: interactionIds
  };
}

module.exports = { createSetupHub };
