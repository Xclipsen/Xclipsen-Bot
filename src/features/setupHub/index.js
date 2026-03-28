const { ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');

const { createSetupHubRenderers } = require('./renderers');

const EVENT_ROLE_PANEL_DEFINITIONS = [
  {
    key: 'spookyFestival',
    label: 'Spooky Festival',
    reactionEmoji: '🎃'
  },
  {
    key: 'travelingZoo',
    label: 'Traveling Zoo',
    reactionEmoji: '🐾'
  },
  {
    key: 'hoppitysHunt',
    label: "Hoppity's Hunt",
    reactionEmoji: '🥚'
  },
  {
    key: 'seasonOfJerry',
    label: 'Season of Jerry',
    reactionEmoji: '🎁'
  },
  {
    key: 'darkAuction',
    label: 'Dark Auction',
    reactionEmoji: '🕴️'
  },
  {
    key: 'cakeReminder',
    label: 'Cake Reminder',
    reactionEmoji: '🍰'
  },
  {
    key: 'cultReminder',
    label: 'Cult Reminder',
    reactionEmoji: '🔮'
  }
];

function createSetupHub({ store, ensureSetupAccess, mayorAlerts, modUpdates, eventReminders, reactionRoles, itemEmojis, interactionIds }) {
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
    SETUP_EVENT_REMINDERS_TEST_ALL_ID,
    SETUP_EVENT_REMINDERS_POST_ROLE_PANEL_ID,
    SETUP_EVENT_ROLE_PANEL_MODAL_ID,
    SETUP_MAYOR_TOGGLE_ELECTION_PING_ID,
    SETUP_MAYOR_TOGGLE_CHANGE_PING_ID,
    SETUP_MAYOR_RELOAD_ID,
    SETUP_MAYOR_RESET_ID,
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
    SETUP_EVENT_REMINDERS_ROLES_INPUT_ID,
    SETUP_EVENT_ROLE_PANEL_CHANNEL_INPUT_ID,
    SETUP_CHANNEL_INPUT_ID,
    SETUP_ROLE_INPUT_ID
  } = interactionIds;

  function isSnowflake(value) {
    return /^\d{16,20}$/.test(String(value || '').trim());
  }

  function formatEventRoleDisplayName(role) {
    const roleId = String(role?.id || '').trim();
    if (!roleId) {
      return 'role not defined';
    }

    return `<@&${roleId}>`;
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

  async function buildEventRolePanelLines(guild, guildId) {
    const eventConfig = store.getGuildConfig(guildId).eventReminders;

    return Promise.all(EVENT_ROLE_PANEL_DEFINITIONS.map(async (definition) => {
      const roleId = eventConfig.roles[definition.key] || null;
      const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
      const roleText = role
        ? formatEventRoleDisplayName(role)
        : 'role not defined';

      return `${definition.reactionEmoji} ${definition.label} -> ${roleText}`;
    }));
  }

  async function postEventRolePanel(guild, channelId) {
    const eventConfig = store.getGuildConfig(guild.id).eventReminders;
    const runtimeState = store.getGuildRuntimeState(guild.id).eventReminders;
    const normalizedChannelId = String(channelId || '').trim();

    if (!isSnowflake(normalizedChannelId)) {
      throw new Error('Channel ID must be a valid Discord snowflake.');
    }

    const channel = await guild.channels.fetch(normalizedChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Selected channel is invalid or not text-based.');
    }

    if (!guild.members.me) {
      await guild.members.fetchMe();
    }

    const botPermissions = channel.permissionsFor(guild.members.me);
    if (!botPermissions?.has(PermissionsBitField.Flags.ManageWebhooks)) {
      throw new Error('Bot needs Manage Webhooks in the events channel to post the event role panel via webhook.');
    }

    const existingWebhooks = await channel.fetchWebhooks().catch(() => null);
    const webhook = existingWebhooks?.find((entry) => (
      entry.owner?.id === guild.client.user?.id &&
      entry.token &&
      entry.name === 'Xclipsen Event Roles'
    )) || await channel.createWebhook({
      name: 'Xclipsen Event Roles',
      avatar: guild.client.user?.displayAvatarURL() || undefined
    });

    if (runtimeState.eventRolePanelMessageId && runtimeState.eventRolePanelChannelId) {
      const previousChannel = await guild.channels.fetch(runtimeState.eventRolePanelChannelId).catch(() => null);
      const previousMessage = previousChannel?.isTextBased()
        ? await previousChannel.messages.fetch(runtimeState.eventRolePanelMessageId).catch(() => null)
        : null;

      if (previousMessage) {
        await previousMessage.delete().catch(() => null);
      }

      const remainingReactionRoles = store.getReactionRoleEntries(guild.id).filter((entry) => !(
        entry.channelId === runtimeState.eventRolePanelChannelId &&
        entry.messageId === runtimeState.eventRolePanelMessageId
      ));
      store.setReactionRoleEntries(guild.id, remainingReactionRoles);
    }

    const message = await webhook.send({
      content: [
        '**SkyBlock Event Roles**',
        'React below to add or remove event ping roles.',
        '',
        ...(await buildEventRolePanelLines(guild, guild.id))
      ].join('\n'),
      allowedMentions: { parse: [] },
      wait: true
    });

    const configuredBindings = [];
    for (const definition of EVENT_ROLE_PANEL_DEFINITIONS) {
      const roleId = eventConfig.roles[definition.key] || null;
      if (!roleId) {
        continue;
      }

      await reactionRoles.addReactionRoleBinding(guild.id, message, roleId, definition.reactionEmoji);
      configuredBindings.push(`${definition.reactionEmoji} -> <@&${roleId}>`);
    }

    store.setGuildRuntimeState(guild.id, {
      ...store.getGuildRuntimeState(guild.id),
      eventReminders: {
        ...store.getGuildRuntimeState(guild.id).eventReminders,
        eventRolePanelMessageId: message.id,
        eventRolePanelChannelId: message.channelId
      }
    });

    return {
      message,
      configuredBindings
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

    if (interaction.customId === SETUP_EVENT_REMINDERS_TEST_ALL_ID) {
      await interaction.deferUpdate();

      let note;
      try {
        await eventReminders.sendTestReminders(interaction.guildId);
        note = 'Sent test reminders for all configured events to the shared events channel.';
      } catch (error) {
        console.error(`Failed to send event reminder test batch for guild ${interaction.guildId}:`, error);
        note = 'Event reminder test batch failed. Check the configured channel, roles, and bot permissions.';
      }

      await interaction.editReply({
        embeds: [renderers.createEventRemindersSetupEmbed(interaction.guild, note)],
        components: renderers.createEventRemindersSetupComponents()
      });
      return;
    }

    if (interaction.customId === SETUP_EVENT_REMINDERS_POST_ROLE_PANEL_ID) {
      await interaction.showModal(renderers.createEventRolePanelModal(store.getGuildConfig(interaction.guildId).eventReminders.channelId || ''));
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

    let validatedSetup;
    let roles;
    try {
      roles = parseEventReminderRoles(interaction.fields.getTextInputValue(SETUP_EVENT_REMINDERS_ROLES_INPUT_ID));
      validatedSetup = await validateOptionalChannelRoleInputs(
        interaction.guild,
        interaction.fields.getTextInputValue(SETUP_EVENT_REMINDERS_CHANNEL_INPUT_ID),
        Object.values(roles).find(Boolean) || null
      );
    } catch (error) {
      await interaction.editReply({ content: error.message });
      return;
    }

    try {
      for (const roleId of Object.values(roles)) {
        if (!roleId) {
          continue;
        }

        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          throw new Error(`The role ID is invalid or not part of this server: ${roleId}`);
        }
      }
    } catch (error) {
      await interaction.editReply({ content: error.message });
      return;
    }

    store.setGuildConfig(interaction.guildId, {
      eventReminders: {
        channelId: validatedSetup.channelId,
        roles
      }
    });

    store.setGuildRuntimeState(interaction.guildId, {
      ...store.getGuildRuntimeState(interaction.guildId),
      eventReminders: {
        lastSentStarts: {}
      }
    });

    await interaction.editReply({
      embeds: [renderers.createEventRemindersSetupEmbed(
        interaction.guild,
        validatedSetup.channelId
          ? 'Event reminder config saved successfully.'
          : 'Event reminders disabled for this server.'
      )],
      components: renderers.createEventRemindersSetupComponents(),
      content: null
    });
  }

  async function handleEventRolePanelModalSubmit(interaction) {
    if (!(await ensureSetupAccess(interaction, 'event role panel form'))) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let note;
    try {
      const channelId = interaction.fields.getTextInputValue(SETUP_EVENT_ROLE_PANEL_CHANNEL_INPUT_ID).trim();
      const result = await postEventRolePanel(interaction.guild, channelId);
      note = result.configuredBindings.length > 0
        ? `Posted an event role panel in <#${result.message.channelId}> and bound ${result.configuredBindings.join(', ')}.`
        : `Posted an event role panel in <#${result.message.channelId}>, but no event roles are configured yet.`;
    } catch (error) {
      console.error(`Failed to post event role panel for guild ${interaction.guildId}:`, error);
      note = `Event role panel failed: ${error.message}`;
    }

    await interaction.editReply({
      embeds: [renderers.createEventRemindersSetupEmbed(interaction.guild, note)],
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
    handleEventRolePanelModalSubmit,
    handleModUpdatesSetupModalSubmit,
    handleReactionRoleModalSubmit,
    handleReactionRolePurgeChannelModalSubmit,
    handleShitterSetupModalSubmit,
    ids: interactionIds
  };

}

function parseEventReminderRoles(rawValue) {
  const aliases = {
    spooky: 'spookyFestival',
    zoo: 'travelingZoo',
    hoppity: 'hoppitysHunt',
    jerry: 'seasonOfJerry',
    darkauction: 'darkAuction',
    da: 'darkAuction',
    dark_auction: 'darkAuction',
    cake: 'cakeReminder',
    cult: 'cultReminder'
  };

  const roles = {
    spookyFestival: null,
    travelingZoo: null,
    hoppitysHunt: null,
    seasonOfJerry: null,
    darkAuction: null,
    cakeReminder: null,
    cultReminder: null
  };

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
    const key = aliases[rawKey];

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
