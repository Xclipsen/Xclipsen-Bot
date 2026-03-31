const { MessageFlags } = require('discord.js');

const { createSetupHubRenderers } = require('./renderers');
const { EVENT_DEFINITIONS } = require('../eventCalendar');

function createSetupHub({ store, ensureSetupAccess, mayorAlerts, modUpdates, eventReminders, reactionRoles, interactionIds }) {
  const renderers = createSetupHubRenderers({ store, reactionRoles, interactionIds });
  const {
    SETUP_VIEW_HOME_ID,
    SETUP_VIEW_DISCORD_ID,
    SETUP_VIEW_PLAYER_TOOLS_ID,
    SETUP_VIEW_MAYOR_ID,
    SETUP_VIEW_EVENT_REMINDERS_ID,
    SETUP_VIEW_MOD_UPDATES_ID,
    SETUP_MAYOR_EDIT_ID,
    SETUP_EVENT_REMINDERS_MODAL_ID,
    SETUP_EVENT_REMINDERS_QUICK_SETUP_ID,
    SETUP_EVENT_REMINDERS_POST_ROLE_MESSAGE_ID,
    SETUP_MAYOR_TOGGLE_ELECTION_PING_ID,
    SETUP_MAYOR_TOGGLE_CHANGE_PING_ID,
    SETUP_MOD_UPDATES_MODAL_ID,
    SETUP_MOD_UPDATES_REFRESH_ID,
    SETUP_MOD_UPDATES_TEST_ID,
    SETUP_VIEW_REACTION_ROLES_ID,
    SETUP_VIEW_SHITTER_ID,
    SETUP_REACTION_ADD_MODAL_ID,
    SETUP_REACTION_REMOVE_MODAL_ID,
    SETUP_REACTION_PURGE_ALL_ID,
    SETUP_REACTION_PURGE_CHANNEL_MODAL_ID,
    SETUP_SHITTER_MODAL_ID,
    SETUP_REACTION_CHANNEL_INPUT_ID,
    SETUP_REACTION_MESSAGE_INPUT_ID,
    SETUP_REACTION_ROLE_INPUT_ID,
    SETUP_REACTION_EMOJI_INPUT_ID,
    SETUP_REACTION_REQUIRED_ROLE_INPUT_ID,
    SETUP_REACTION_PURGE_CHANNEL_INPUT_ID,
    SETUP_SHITTER_BLOCKED_USERS_INPUT_ID,
    SETUP_SHITTER_BLOCKED_ROLES_INPUT_ID,
    SETUP_SHITTER_ALLOWED_ROLES_INPUT_ID,
    SETUP_MOD_UPDATES_CHANNEL_INPUT_ID,
    SETUP_MOD_UPDATES_ROLE_INPUT_ID,
    SETUP_MOD_UPDATES_REPOS_INPUT_ID,
    SETUP_EVENT_REMINDERS_CHANNEL_INPUT_ID,
    SETUP_EVENT_REMINDERS_ROLE_PANEL_CHANNEL_INPUT_ID,
    SETUP_EVENT_REMINDERS_ROLES_INPUT_ID,
    SETUP_ROLE_INPUT_ID
  } = interactionIds;

  function isSnowflake(value) {
    return /^\d{16,20}$/.test(String(value || '').trim());
  }

  async function validateMayorRoleInput(guild, roleId) {
    if (!isSnowflake(roleId)) {
      throw new Error('Role ID must be a valid Discord snowflake.');
    }

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      throw new Error('The role ID is invalid or not part of this server.');
    }

    return { role };
  }

  async function validateModUpdatesSetupInputs(guild, channelId, roleId) {
    const normalizedChannelId = String(channelId || '').trim() || null;
    const normalizedRoleId = String(roleId || '').trim() || null;

    if (normalizedChannelId && !isSnowflake(normalizedChannelId)) {
      throw new Error('Channel ID must be a valid Discord snowflake.');
    }

    if (normalizedRoleId && !isSnowflake(normalizedRoleId)) {
      throw new Error('Role ID must be a valid Discord snowflake.');
    }

    if (normalizedRoleId && !normalizedChannelId) {
      throw new Error('Set a channel ID before configuring a ping role.');
    }

    if (normalizedChannelId) {
      const channel = await guild.channels.fetch(normalizedChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        throw new Error('The channel ID is invalid or not a text-based channel in this server.');
      }
    }

    if (normalizedRoleId) {
      const role = await guild.roles.fetch(normalizedRoleId).catch(() => null);
      if (!role) {
        throw new Error('The role ID is invalid or not part of this server.');
      }
    }

    return {
      channelId: normalizedChannelId,
      roleId: normalizedRoleId
    };
  }

  async function validateOptionalChannelRoleInputs(guild, channelId, roleId) {
    const normalizedChannelId = String(channelId || '').trim() || null;
    const normalizedRoleId = String(roleId || '').trim() || null;

    if (normalizedChannelId && !isSnowflake(normalizedChannelId)) {
      throw new Error('Channel ID must be a valid Discord snowflake.');
    }

    if (normalizedRoleId && !isSnowflake(normalizedRoleId)) {
      throw new Error('Role ID must be a valid Discord snowflake.');
    }

    if (normalizedRoleId && !normalizedChannelId) {
      throw new Error('Set a channel ID before configuring a ping role.');
    }

    if (normalizedChannelId) {
      const channel = await guild.channels.fetch(normalizedChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        throw new Error('The channel ID is invalid or not a text-based channel in this server.');
      }
    }

    if (normalizedRoleId) {
      const role = await guild.roles.fetch(normalizedRoleId).catch(() => null);
      if (!role) {
        throw new Error('The role ID is invalid or not part of this server.');
      }
    }

    return {
      channelId: normalizedChannelId,
      roleId: normalizedRoleId
    };
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

  async function buildModUpdatesView(guild, note = null) {
    const releaseStatuses = await modUpdates.fetchTrackedReleaseStatuses(guild.id);

    return {
      embeds: [renderers.createModUpdatesSetupEmbed(guild, releaseStatuses, note)],
      components: renderers.createModUpdatesSetupComponents()
    };
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

  function createEmptyEventRoles() {
    return Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [definition.key, null]));
  }

  async function validateEventReminderRoles(guild, roles) {
    for (const [eventKey, roleId] of Object.entries(roles || {})) {
      if (!roleId) {
        continue;
      }

      if (!isSnowflake(roleId)) {
        throw new Error(`Role ID for ${eventKey} must be a valid Discord snowflake.`);
      }

      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        throw new Error(`The role ID is invalid or not part of this server: ${roleId}`);
      }
    }
  }

  async function resolveQuickSetupEventRoles(guild) {
    const existingConfig = store.getGuildConfig(guild.id);
    const fetchedRoles = await guild.roles.fetch();
    const roles = [...fetchedRoles.values()]
      .filter((role) => role && role.id !== guild.id && !role.managed);
    const eventRoles = createEmptyEventRoles();
    let createdCount = 0;

    for (const definition of EVENT_DEFINITIONS) {
      const configuredRoleId = existingConfig.eventReminders.roles[definition.key] || null;
      if (configuredRoleId) {
        const configuredRole = await guild.roles.fetch(configuredRoleId).catch(() => null);
        if (configuredRole) {
          eventRoles[definition.key] = configuredRole.id;
          continue;
        }
      }

      const aliases = [
        definition.roleName,
        `${definition.roleName} Ping`,
        `${definition.roleName} Role`,
        ...definition.roleAliases
      ];
      const existingRoleId = findMatchingRoleId(roles, aliases);
      if (existingRoleId) {
        eventRoles[definition.key] = existingRoleId;
        continue;
      }

      const createdRole = await guild.roles.create({
        name: definition.roleName,
        mentionable: false,
        reason: `Quick setup for ${definition.label} event ping role`
      });
      roles.push(createdRole);
      eventRoles[definition.key] = createdRole.id;
      createdCount += 1;
    }

    return {
      eventRoles,
      createdCount
    };
  }

  async function deleteExistingEventRoleMessage(guild) {
    const runtimeState = store.getGuildRuntimeState(guild.id).eventReminders;
    const messageId = runtimeState.rolePanelMessageId;
    const channelId = runtimeState.rolePanelChannelId;

    if (messageId) {
      reactionRoles.purgeReactionRoleBindings(guild.id, { channelId: channelId || undefined, messageId });
    }

    if (messageId && channelId) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      const message = channel && channel.isTextBased()
        ? await channel.messages.fetch(messageId).catch(() => null)
        : null;
      if (message) {
        await message.delete().catch(() => null);
      }
    }

    store.setGuildRuntimeState(guild.id, {
      ...store.getGuildRuntimeState(guild.id),
      eventReminders: {
        ...store.getGuildRuntimeState(guild.id).eventReminders,
        rolePanelMessageId: null,
        rolePanelChannelId: null
      }
    });
  }

  async function postEventRoleMessage(guild, channelId, roles) {
    if (!channelId) {
      throw new Error('Set the Role Message channel before posting the role message.');
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured Event Calendar channel is invalid or not text-based.');
    }

    const roleEntries = EVENT_DEFINITIONS
      .map((definition) => {
        const roleId = roles?.[definition.key] || null;
        if (!roleId) {
          return null;
        }

        return {
          key: definition.key,
          label: definition.label,
          emoji: definition.emoji,
          roleId,
          roleMention: `<@&${roleId}>`
        };
      })
      .filter(Boolean);

    if (roleEntries.length === 0) {
      throw new Error('Configure at least one event role before posting the role message.');
    }

    await deleteExistingEventRoleMessage(guild);

    const message = await channel.send({
      embeds: [renderers.createEventRolePanelEmbed(roleEntries)],
      allowedMentions: { parse: [] }
    });

    for (const roleEntry of roleEntries) {
      await reactionRoles.addReactionRoleBinding(guild.id, message, roleEntry.roleId, roleEntry.emoji);
    }

    store.setGuildRuntimeState(guild.id, {
      ...store.getGuildRuntimeState(guild.id),
      eventReminders: {
        ...store.getGuildRuntimeState(guild.id).eventReminders,
        rolePanelMessageId: message.id,
        rolePanelChannelId: message.channelId
      }
    });

    return message;
  }

  async function applyEventCalendarConfig(guild, channelId, rolePanelChannelId, eventRoles) {
    const existingConfig = store.getGuildConfig(guild.id);
    const existingState = store.getGuildRuntimeState(guild.id);

    if (existingConfig.eventReminders.channelId || existingConfig.channelId) {
      await mayorAlerts.deleteTrackedMessagesForGuild?.(guild.id).catch(() => null);
    }

    await deleteExistingEventRoleMessage(guild);

    store.setGuildConfig(guild.id, {
      channelId,
      roleId: existingConfig.roleId,
      eventReminders: {
        ...existingConfig.eventReminders,
        channelId,
        rolePanelChannelId,
        roles: {
          ...createEmptyEventRoles(),
          ...eventRoles
        }
      }
    });

    store.setGuildRuntimeState(guild.id, {
      ...existingState,
      statusMessageId: null,
      statusChannelId: null,
      eventReminders: {
        ...existingState.eventReminders,
        lastSentStarts: {},
        messageIds: {},
        messageExpireAts: {},
        channelId,
        rolePanelMessageId: null,
        rolePanelChannelId: null
      }
    });

    await mayorAlerts.refreshStatusForGuild(guild.id);
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

    if (interaction.customId === SETUP_VIEW_EVENT_REMINDERS_ID) {
      await updateSetupView(interaction, renderers.createEventRemindersSetupEmbed(interaction.guild), renderers.createEventRemindersSetupComponents());
      return;
    }

    if (interaction.customId === SETUP_VIEW_MOD_UPDATES_ID) {
      await interaction.deferUpdate();
      await interaction.editReply(await buildModUpdatesView(interaction.guild));
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

    if (interaction.customId === SETUP_REACTION_PURGE_CHANNEL_MODAL_ID) {
      await interaction.showModal(renderers.createReactionRolePurgeChannelModal());
      return;
    }

    if (interaction.customId === SETUP_REACTION_PURGE_ALL_ID) {
      await interaction.deferUpdate();

      const removedCount = reactionRoles.purgeReactionRoleBindings(interaction.guildId);
      const note = removedCount > 0
        ? `Purged ${removedCount} reaction role binding(s) from this server.`
        : 'No reaction role bindings found to purge.';

      await interaction.editReply({
        embeds: [renderers.createReactionRoleSetupEmbed(interaction.guild, note)],
        components: renderers.createReactionRoleSetupComponents()
      });
      return;
    }

    if (interaction.customId === SETUP_MOD_UPDATES_MODAL_ID) {
      await interaction.showModal(renderers.createModUpdatesSetupModal(store.getGuildConfig(interaction.guildId).modUpdates));
      return;
    }

    if (interaction.customId === SETUP_EVENT_REMINDERS_MODAL_ID) {
      await interaction.showModal(renderers.createEventRemindersSetupModal(store.getGuildConfig(interaction.guildId).eventReminders));
      return;
    }

    if (interaction.customId === SETUP_EVENT_REMINDERS_QUICK_SETUP_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        if (!interaction.channel || !interaction.channel.isTextBased()) {
          throw new Error('Current channel is not text-based.');
        }

        const quickSetupRoles = await resolveQuickSetupEventRoles(interaction.guild);
        await applyEventCalendarConfig(interaction.guild, interaction.channelId, interaction.channelId, quickSetupRoles.eventRoles);
        await postEventRoleMessage(interaction.guild, interaction.channelId, quickSetupRoles.eventRoles);
        const configuredEventRoles = Object.values(quickSetupRoles.eventRoles).filter(Boolean).length;
        note = [
          `Event Calendar quick setup complete. Shared channel set to <#${interaction.channelId}>.`,
          `Event roles configured: ${configuredEventRoles}.`,
          `New roles created: ${quickSetupRoles.createdCount}.`,
          'Reaction-role message was rebuilt in this channel.'
        ].join('\n');
      } catch (error) {
        console.error(`Failed to quick-setup event calendar for guild ${interaction.guildId}:`, error);
        note = `Event Calendar quick setup failed: ${error.message}`;
      }

      await interaction.editReply({
        embeds: [renderers.createEventRemindersSetupEmbed(interaction.guild, note)],
        components: renderers.createEventRemindersSetupComponents()
      });
      return;
    }

    if (interaction.customId === SETUP_EVENT_REMINDERS_POST_ROLE_MESSAGE_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        const config = store.getGuildConfig(interaction.guildId).eventReminders;
        await postEventRoleMessage(interaction.guild, config.rolePanelChannelId || config.channelId, config.roles);
        note = 'Event reaction-role message rebuilt successfully.';
      } catch (error) {
        console.error(`Failed to rebuild event role message for guild ${interaction.guildId}:`, error);
        note = `Could not rebuild the event role message: ${error.message}`;
      }

      await interaction.editReply({
        embeds: [renderers.createEventRemindersSetupEmbed(interaction.guild, note)],
        components: renderers.createEventRemindersSetupComponents()
      });
      return;
    }

    if (interaction.customId === SETUP_MAYOR_EDIT_ID) {
      await interaction.showModal(renderers.createMayorSetupModal(store.getGuildConfig(interaction.guildId)));
      return;
    }

    if (interaction.customId === SETUP_MOD_UPDATES_REFRESH_ID) {
      await interaction.deferUpdate();
      if (store.getGuildConfig(interaction.guildId).modUpdates.channelId) {
        await modUpdates.syncStatusMessage(interaction.guildId).catch((error) => {
          console.error(`Failed to refresh mod update status message for guild ${interaction.guildId}:`, error);
        });
      }
      await interaction.editReply(await buildModUpdatesView(interaction.guild, 'Refreshed latest release data from GitHub.'));
      return;
    }

    if (interaction.customId === SETUP_MOD_UPDATES_TEST_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        await modUpdates.sendTestNotification(interaction.guildId);
        note = 'Sent a mod update test ping to the configured channel.';
      } catch (error) {
        console.error(`Failed to send mod update test ping for guild ${interaction.guildId}:`, error);
        note = 'Mod update test ping failed. Check the configured channel, role, and bot permissions.';
      }

      await interaction.editReply(await buildModUpdatesView(interaction.guild, note));
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

    const roleId = interaction.fields.getTextInputValue(SETUP_ROLE_INPUT_ID).trim();
    const validationResult = await validateMayorRoleInput(interaction.guild, roleId).catch((error) => error);

    if (validationResult instanceof Error) {
      await interaction.editReply({ content: validationResult.message });
      return;
    }

    store.setGuildConfig(interaction.guildId, {
      roleId
    });
    store.setGuildRuntimeState(interaction.guildId, { statusMessageId: null, statusChannelId: null });

    let setupNote = 'Mayor alert config saved successfully.';
    try {
      const data = await mayorAlerts.fetchElectionData();
      const mayor = data.mayor;
      const currentElection = data.current || null;
      const boothOpen = mayorAlerts.getBoothOpen(data);
      await mayorAlerts.sendMayorStatusUpdate(interaction.guildId, mayor, boothOpen, currentElection);
      store.setGuildRuntimeState(interaction.guildId, { ...store.getGuildRuntimeState(interaction.guildId), boothOpen });
      setupNote = `Mayor alert config saved successfully. Updated the shared calendar status for ${mayor.name}.`;
    } catch (error) {
      console.error(`Failed to send immediate status update for guild ${interaction.guildId}:`, error);
      setupNote = 'Mayor alert config saved successfully, but the shared calendar status could not be posted yet.';
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

  async function handleReactionRolePurgeChannelModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'reaction role purge form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = interaction.fields.getTextInputValue(SETUP_REACTION_PURGE_CHANNEL_INPUT_ID).trim();
    if (!isSnowflake(channelId)) {
      await interaction.editReply({ content: 'Channel ID must be a valid Discord snowflake.' });
      return;
    }

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({ content: 'The channel ID is invalid or not a text-based channel in this server.' });
      return;
    }

    const removedCount = reactionRoles.purgeReactionRoleBindings(interaction.guildId, { channelId });
    const note = removedCount > 0
      ? `Purged ${removedCount} reaction role binding(s) from <#${channelId}>.`
      : `No reaction role bindings found for <#${channelId}>.`;

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

  async function handleModUpdatesSetupModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'mod update setup form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let trackedRepos;
    let validatedSetup;
    try {
      validatedSetup = await validateModUpdatesSetupInputs(
        interaction.guild,
        interaction.fields.getTextInputValue(SETUP_MOD_UPDATES_CHANNEL_INPUT_ID),
        interaction.fields.getTextInputValue(SETUP_MOD_UPDATES_ROLE_INPUT_ID)
      );
      trackedRepos = modUpdates
        .parseTrackedReposInput(interaction.fields.getTextInputValue(SETUP_MOD_UPDATES_REPOS_INPUT_ID))
        .map((repo) => repo.url);
    } catch (error) {
      await interaction.editReply({ content: error.message });
      return;
    }

    store.setGuildConfig(interaction.guildId, {
      modUpdates: {
        channelId: validatedSetup.channelId,
        roleId: validatedSetup.roleId,
        trackedRepos
      }
    });

    store.setGuildRuntimeState(interaction.guildId, {
      modUpdates: {
        ...store.getGuildRuntimeState(interaction.guildId).modUpdates,
        statusMessageId: null,
        statusChannelId: null,
        alertMessageId: null,
        alertChannelId: null
      }
    });

    await modUpdates.deleteTrackedStatusMessages(interaction.guildId).catch((error) => {
      console.error(`Failed to delete old mod update status messages for guild ${interaction.guildId}:`, error);
    });

    if (validatedSetup.channelId && trackedRepos.length > 0) {
      await modUpdates.syncStatusMessage(interaction.guildId).catch((error) => {
        console.error(`Failed to post mod update status message for guild ${interaction.guildId}:`, error);
      });
    }

    await interaction.editReply({
      ...(await buildModUpdatesView(
        interaction.guild,
        trackedRepos.length === 0
          ? 'Mod update tracking cleared for this server.'
          : validatedSetup.channelId
            ? 'Mod update config saved successfully. The channel now keeps one sorted mod list and sends a fresh ping on new updates.'
            : 'Tracked GitHub repositories saved successfully, but automatic posts stay disabled until you set a channel.'
      )),
      content: null
    });
  }

  async function handleEventRemindersSetupModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'event reminders setup form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let calendarChannelId;
    let rolePanelChannelId;
    let roles;
    try {
      roles = parseEventReminderRoles(interaction.fields.getTextInputValue(SETUP_EVENT_REMINDERS_ROLES_INPUT_ID));
      calendarChannelId = (await validateOptionalChannelRoleInputs(
        interaction.guild,
        interaction.fields.getTextInputValue(SETUP_EVENT_REMINDERS_CHANNEL_INPUT_ID),
        null
      )).channelId;
      rolePanelChannelId = (await validateOptionalChannelRoleInputs(
        interaction.guild,
        interaction.fields.getTextInputValue(SETUP_EVENT_REMINDERS_ROLE_PANEL_CHANNEL_INPUT_ID),
        null
      )).channelId;
      await validateEventReminderRoles(interaction.guild, roles);
    } catch (error) {
      await interaction.editReply({ content: error.message });
      return;
    }

    try {
      if (calendarChannelId) {
        await applyEventCalendarConfig(interaction.guild, calendarChannelId, rolePanelChannelId, roles);
      } else {
        await deleteExistingEventRoleMessage(interaction.guild).catch(() => null);

        store.setGuildConfig(interaction.guildId, {
          channelId: null,
          eventReminders: {
            ...store.getGuildConfig(interaction.guildId).eventReminders,
            channelId: null,
            rolePanelChannelId,
            roles
          }
        });

        store.setGuildRuntimeState(interaction.guildId, {
          ...store.getGuildRuntimeState(interaction.guildId),
          statusMessageId: null,
          statusChannelId: null,
          eventReminders: {
            ...store.getGuildRuntimeState(interaction.guildId).eventReminders,
            lastSentStarts: {},
            messageIds: {},
            messageExpireAts: {},
            channelId: null,
            rolePanelMessageId: null,
            rolePanelChannelId: null
          }
        });
      }
    } catch (error) {
      console.error(`Failed to save event calendar setup for guild ${interaction.guildId}:`, error);
      await interaction.editReply({ content: error.message });
      return;
    }

    await interaction.editReply({
      embeds: [renderers.createEventRemindersSetupEmbed(
        interaction.guild,
        calendarChannelId
          ? 'Event Calendar config saved successfully.'
          : 'Event Calendar posts disabled for this server.'
      )],
      components: renderers.createEventRemindersSetupComponents(),
      content: null
    });
  }

  return {
    handleSetupCommand,
    handleSetupNavigationButton,
    handleSetupActionButton,
    handleMayorSetupModalSubmit,
    handleEventRemindersSetupModalSubmit,
    handleModUpdatesSetupModalSubmit,
    handleReactionRoleModalSubmit,
    handleReactionRolePurgeChannelModalSubmit,
    handleShitterSetupModalSubmit,
    ids: interactionIds
  };

}

function parseEventReminderRoles(rawValue) {
  const aliases = Object.fromEntries(EVENT_DEFINITIONS.flatMap((definition) => {
    const compactKey = definition.key.toLowerCase();
    const snakeKey = definition.key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).toLowerCase();
    const compactLabel = definition.label.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const snakeLabel = definition.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    return [
      [compactKey, definition.key],
      [snakeKey, definition.key],
      [compactLabel, definition.key],
      [snakeLabel, definition.key]
    ];
  }));

  const roles = Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [definition.key, null]));

  const lines = String(rawValue || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid role mapping: ${line}`);
    }

    const rawKey = line.slice(0, separatorIndex).trim().toLowerCase();
    const rawRoleId = line.slice(separatorIndex + 1).trim();
    const key = aliases[rawKey.replace(/[^a-z0-9_]+/g, '')];

    if (!key) {
      throw new Error(`Unknown event role key: ${rawKey}`);
    }

    if (!rawRoleId) {
      roles[key] = null;
      continue;
    }

    if (!/^\d{16,20}$/.test(rawRoleId)) {
      throw new Error(`Invalid Discord ID: ${rawRoleId}`);
    }

    roles[key] = rawRoleId;
  }

  return roles;
}

module.exports = { createSetupHub };
