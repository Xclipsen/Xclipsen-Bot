const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const { getHelpSectionById } = require('../../config/help');
const { EVENT_DEFINITIONS } = require('../eventCalendar');

const EVENT_ROLE_INPUT_PLACEHOLDER = 'darkAuction=123456789012345678\ncultOfTheFallenStar=234567890123456789';

function createSetupHubRenderers({ store, reactionRoles, interactionIds }) {
  const {
    SETUP_MODAL_ID,
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

  function getShitterStats(guildId) {
    const entries = store.getShitterEntries(guildId);
    const activeEntries = entries.filter((entry) => !entry.removedAt);
    const activeNames = new Set(activeEntries.map((entry) => entry.normalizedIgn)).size;

    return {
      totalEntries: entries.length,
      activeEntries: activeEntries.length,
      activeNames
    };
  }

  function buildEventRoleLines(roles) {
    return EVENT_DEFINITIONS
      .map((definition) => `${definition.label}: ${roles?.[definition.key] ? `<@&${roles[definition.key]}>` : 'Off'}`)
      .join('\n');
  }

  function buildEventRoleInputLines(roles) {
    return EVENT_DEFINITIONS
      .map((definition) => `${definition.key}=${roles?.[definition.key] || ''}`)
      .join('\n');
  }

  function createSetupHubEmbed(guild, note = null) {
    const description = [
      'Choose a category to manage server-specific bot settings.',
      'Discord contains the current mayor alerts, mod update tracking, reaction roles, and shitter configuration.',
      'Player Tools gives admins a quick overview of the user-facing Minecraft utility commands.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Discord', value: 'Mayor alerts, mod update posting, current status embeds, and reaction role management.', inline: false },
        { name: 'Player Tools', value: 'UUID lookup, name history, catacombs, and shitter lookup reference.', inline: false },
        { name: 'More Coming Soon', value: 'Use this hub as the central place for new bot modules later on.', inline: false }
      )
      .setFooter({ text: 'Use the buttons below to navigate.' });
  }

  function createDiscordSetupEmbed(guild, note = null) {
    const config = store.getGuildConfig(guild.id);
    const shitterStats = getShitterStats(guild.id);
    const description = [
      'This section groups the current Discord-side bot configuration.',
      'Open Mayor Alerts to control the shared calendar/status embed and mayor ping role.',
      'Open Event Calendar to use the same calendar channel with event-specific ping roles.',
      'Open Mod Updates to choose a release channel, optional ping role, and tracked GitHub repos.',
      'Open Reaction Roles to manage message-based role toggles.',
      'Open Shitter List to control who can add or remove shitter entries and store evidence screenshots.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord')
      .setDescription(description.join('\n'))
      .addFields(
        {
          name: 'Mayor Alerts',
          value: [
            `Role: ${config.roleId ? `<@&${config.roleId}>` : 'Not configured'}`,
            `Election ping: ${config.mayorAlerts.pingElectionOpen ? 'On' : 'Off'}`,
            `Mayor change ping: ${config.mayorAlerts.pingMayorChange ? 'On' : 'Off'}`
          ].join('\n'),
          inline: false
        },
        {
          name: 'Event Calendar',
          value: [
            `Shared Channel: ${config.eventReminders.channelId ? `<#${config.eventReminders.channelId}>` : 'Not configured'}`,
            `Role Message Channel: ${config.eventReminders.rolePanelChannelId ? `<#${config.eventReminders.rolePanelChannelId}>` : 'Not configured'}`,
            'Mayor status uses this same channel.',
            buildEventRoleLines(config.eventReminders.roles)
          ].join('\n'),
          inline: false
        },
        {
          name: 'Mod Updates',
          value: [
            `Channel: ${config.modUpdates.channelId ? `<#${config.modUpdates.channelId}>` : 'Not configured'}`,
            `Role: ${config.modUpdates.roleId ? `<@&${config.modUpdates.roleId}>` : 'Not configured'}`,
            `Tracked repos: ${config.modUpdates.trackedRepos.length}`
          ].join('\n'),
          inline: false
        },
        { name: 'Reaction Roles', value: `${config.reactionRoles.length} binding(s) configured`, inline: false },
        {
          name: 'Shitter List',
          value: `Active names: ${shitterStats.activeNames}\nActive entries: ${shitterStats.activeEntries}\nEvidence per entry: up to 5 screenshots`,
          inline: false
        },
        {
          name: 'Shitter Permissions',
          value: `Blocked users: ${config.shitterPermissions.blockedUserIds.length}\nBlocked roles: ${config.shitterPermissions.blockedRoleIds.length}\nAllowed roles: ${config.shitterPermissions.allowedRoleIds.length || 'Everyone'}`,
          inline: false
        }
      )
      .setFooter({ text: 'Pick a Discord settings category.' });
  }

  function createModUpdatesSetupEmbed(guild, releaseStatuses, note = null) {
    const modUpdates = store.getGuildConfig(guild.id).modUpdates;
    const description = [
      'Track public GitHub releases for the mod repositories configured in this server.',
      'Set a Discord channel to keep one always-updated mod list and receive a fresh ping whenever a new update is detected.',
      'Use the config editor below to add one GitHub URL or owner/repo entry per line.'
    ];

    if (note) {
      description.push('', note);
    }

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord - Mod Updates')
      .setDescription(description.join('\n'))
      .setFooter({ text: 'Refresh to fetch the newest release data from GitHub.' });

    embed.addFields({
      name: 'Configuration',
      value: [
        `Channel: ${modUpdates.channelId ? `<#${modUpdates.channelId}>` : 'Not configured'}`,
        `Ping Role: ${modUpdates.roleId ? `<@&${modUpdates.roleId}>` : 'Not configured'}`,
        `Tracked repos: ${modUpdates.trackedRepos.length}`
      ].join('\n'),
      inline: false
    });

    if (modUpdates.trackedRepos.length === 0) {
      embed.addFields({
        name: 'Tracked Repositories',
        value: 'None configured yet. Add one or more GitHub repositories to start tracking releases.',
        inline: false
      });

      return embed;
    }

    for (const status of releaseStatuses.slice(0, 25)) {
      embed.addFields({
        name: status.fullName,
        value: buildModUpdateFieldValue(status),
        inline: false
      });
    }

    return embed;
  }

  function createEventRemindersSetupEmbed(guild, note = null) {
    const eventReminders = store.getGuildConfig(guild.id).eventReminders;
    const runtimeState = store.getGuildRuntimeState(guild.id).eventReminders;
    const description = [
      'This page controls the shared Event Calendar channel and the event-specific ping roles.',
      'Quick Setup creates any missing event roles, uses the current channel as the calendar channel, and posts the event reaction-role message.',
      'When an event starts, the bot sends one active-now ping and deletes it again when the event ends.'
    ];

    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('Setup Hub - Discord - Event Calendar')
      .setDescription(description.join('\n'))
      .addFields({
        name: 'Configuration',
        value: [
          `Shared Calendar Channel: ${eventReminders.channelId ? `<#${eventReminders.channelId}>` : 'Not configured'}`,
          `Role Message Channel: ${eventReminders.rolePanelChannelId ? `<#${eventReminders.rolePanelChannelId}>` : 'Not configured'}`,
          `Reaction Role Message: ${runtimeState.rolePanelMessageId ? `Posted in <#${runtimeState.rolePanelChannelId || eventReminders.rolePanelChannelId || eventReminders.channelId}>` : 'Not posted'}`,
          buildEventRoleLines(eventReminders.roles)
        ].join('\n'),
        inline: false
      })
      .setFooter({ text: 'Edit Config changes the shared channel and role IDs. Post Role Message rebuilds the reaction-role post.' });
  }

  function createPlayerToolsEmbed(guild, note = null) {
    const playerToolsSection = getHelpSectionById('player-tools');
    const shitterStats = getShitterStats(guild.id);
    const description = [
      'These commands do not need extra setup, but they are some of the most useful player-facing tools in the bot.',
      'Use this page as a quick reference for moderators and staff.',
      'Anyone can also use `/help` for the public command guide.'
    ];

    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Player Tools')
      .setDescription(description.join('\n'))
      .addFields(
        ...(playerToolsSection
          ? playerToolsSection.commands.map((command) => ({
              name: command.command,
              value: command.description,
              inline: false
            }))
          : []),
        {
          name: '/shitter query and /shitter list',
          value: `Checks server-local shitter entries. This server currently has ${shitterStats.activeNames} active name(s) across ${shitterStats.activeEntries} active entr${shitterStats.activeEntries === 1 ? 'y' : 'ies'}.`,
          inline: false
        }
      )
      .setFooter({ text: 'This page is informational; run the slash commands directly in chat.' });
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
      'Each shitter entry can include up to 5 screenshot attachments as evidence.',
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
      .addFields({ name: 'Current Bindings', value: reactionRoles.buildReactionRoleSummary(guild.id, { maxLength: 900, maxLines: 10 }), inline: false })
      .setFooter({ text: 'Add or remove bindings with the buttons below.' });
  }

  function createMayorSetupEmbed(guild, note = null) {
    const config = store.getGuildConfig(guild.id);
    const sharedChannelId = config.eventReminders.channelId || config.channelId;
    const description = [
      'Manage mayor pings for the shared SkyBlock calendar in this server.',
      'The calendar channel is configured in Event Calendar. Mayor status posts use that same channel automatically.'
    ];
    if (note) {
      description.push('', note);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Setup Hub - Discord - Mayor Alerts')
      .setDescription(description.join('\n'))
      .addFields(
        { name: 'Calendar Channel', value: sharedChannelId ? `<#${sharedChannelId}>` : 'Not configured in Event Calendar', inline: true },
        { name: 'Mayor Ping Role', value: config.roleId ? `<@&${config.roleId}>` : 'Not configured', inline: true },
        { name: 'Election Booth Ping', value: config.mayorAlerts.pingElectionOpen ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Mayor Change Ping', value: config.mayorAlerts.pingMayorChange ? 'Enabled' : 'Disabled', inline: true }
      )
      .setFooter({ text: 'Set the channel in Event Calendar and manage mayor pings here.' });
  }

  function createSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Discord').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_VIEW_PLAYER_TOOLS_ID).setLabel('Player Tools').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup-placeholder-more').setLabel('More Soon').setStyle(ButtonStyle.Secondary).setDisabled(true)
      )
    ];
  }

  function createPlayerToolsComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_HOME_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createDiscordSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_MAYOR_ID).setLabel('Mayor Alerts').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_VIEW_EVENT_REMINDERS_ID).setLabel('Event Calendar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(SETUP_VIEW_MOD_UPDATES_ID).setLabel('Mod Updates').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
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

  function createMayorSetupComponents(guild) {
    const guildId = typeof guild === 'string' ? guild : guild?.id;
    const mayorAlerts = guildId
      ? store.getGuildConfig(guildId).mayorAlerts
      : { pingElectionOpen: true, pingMayorChange: true };

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_MAYOR_EDIT_ID).setLabel('Edit Config').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_MAYOR_TOGGLE_ELECTION_PING_ID)
          .setLabel(`Booth Ping: ${mayorAlerts.pingElectionOpen ? 'On' : 'Off'}`)
          .setStyle(mayorAlerts.pingElectionOpen ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(SETUP_MAYOR_TOGGLE_CHANGE_PING_ID)
          .setLabel(`Mayor Ping: ${mayorAlerts.pingMayorChange ? 'On' : 'Off'}`)
          .setStyle(mayorAlerts.pingMayorChange ? ButtonStyle.Success : ButtonStyle.Secondary)
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
        new ButtonBuilder().setCustomId(SETUP_REACTION_PURGE_CHANNEL_MODAL_ID).setLabel('Purge Channel').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(SETUP_REACTION_PURGE_ALL_ID).setLabel('Purge All').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createModUpdatesSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_MOD_UPDATES_MODAL_ID).setLabel('Edit Config').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_MOD_UPDATES_REFRESH_ID).setLabel('Refresh').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(SETUP_MOD_UPDATES_TEST_ID).setLabel('Test Ping').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_VIEW_DISCORD_ID).setLabel('Back').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function createEventRemindersSetupComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SETUP_EVENT_REMINDERS_MODAL_ID).setLabel('Edit Config').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SETUP_EVENT_REMINDERS_QUICK_SETUP_ID).setLabel('Quick Setup Here').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(SETUP_EVENT_REMINDERS_POST_ROLE_MESSAGE_ID).setLabel('Post Role Message').setStyle(ButtonStyle.Secondary)
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
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(SETUP_ROLE_INPUT_ID).setLabel('Mayor Ping Role ID').setStyle(TextInputStyle.Short).setRequired(true).setValue(existingConfig.roleId || '').setPlaceholder('1483819173447733419'))
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

  function createReactionRolePurgeChannelModal() {
    return new ModalBuilder()
      .setCustomId(SETUP_REACTION_PURGE_CHANNEL_MODAL_ID)
      .setTitle('Purge Reaction Roles In Channel')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_REACTION_PURGE_CHANNEL_INPUT_ID)
            .setLabel('Channel ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('1093242679493664768')
        )
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

  function createModUpdatesSetupModal(existingConfig) {
    return new ModalBuilder()
      .setCustomId(SETUP_MOD_UPDATES_MODAL_ID)
      .setTitle('Mod Update Config')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_MOD_UPDATES_CHANNEL_INPUT_ID)
            .setLabel('Channel ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(existingConfig.channelId || '')
            .setPlaceholder('1093242679493664768')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_MOD_UPDATES_ROLE_INPUT_ID)
            .setLabel('Ping Role ID (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(existingConfig.roleId || '')
            .setPlaceholder('1483819173447733419')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_MOD_UPDATES_REPOS_INPUT_ID)
            .setLabel('GitHub repos or URLs')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(existingConfig.trackedRepos.join('\n'))
            .setPlaceholder('https://github.com/odtheking/Odin\nowner/repo')
        )
      );
  }

  function createEventRemindersSetupModal(existingConfig) {
    return new ModalBuilder()
      .setCustomId(SETUP_EVENT_REMINDERS_MODAL_ID)
      .setTitle('Event Calendar Config')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_EVENT_REMINDERS_CHANNEL_INPUT_ID)
            .setLabel('Calendar Channel ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(existingConfig.channelId || '')
            .setPlaceholder('1093242679493664768')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_EVENT_REMINDERS_ROLE_PANEL_CHANNEL_INPUT_ID)
            .setLabel('Role Message Channel ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(existingConfig.rolePanelChannelId || '')
            .setPlaceholder('1093242679493664768')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(SETUP_EVENT_REMINDERS_ROLES_INPUT_ID)
            .setLabel('Role IDs (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(buildEventRoleInputLines(existingConfig.roles))
            .setPlaceholder(EVENT_ROLE_INPUT_PLACEHOLDER)
        )
      );
  }

  function createEventRolePanelEmbed(roleEntries) {
    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('Event Ping Roles')
      .setDescription([
        'React below to toggle the event ping roles.',
        '',
        ...roleEntries.map((entry) => `${entry.emoji} ${entry.roleMention} - ${entry.label}`)
      ].join('\n'))
      .setFooter({ text: 'The bot will add or remove the matching role when you react.' });
  }

  function buildModUpdateFieldValue(status) {
    const lines = [`GitHub: [${status.fullName}](${status.repoUrl})`];

    if (status.errorMessage) {
      lines.push(`Latest release: Could not load (${status.errorMessage})`);
      return lines.join('\n');
    }

    if (!status.hasRelease) {
      lines.push('Latest release: No public release found');
      return lines.join('\n');
    }

    lines.push(`Latest release: [${status.latestReleaseName}](${status.latestReleaseUrl})`);

    if (status.publishedAt) {
      const unixTimestamp = Math.floor(new Date(status.publishedAt).getTime() / 1000);
      lines.push(Number.isFinite(unixTimestamp)
        ? `Released: <t:${unixTimestamp}:f> (<t:${unixTimestamp}:R>)`
        : 'Released: Unknown');
    } else {
      lines.push('Released: Unknown');
    }

    return lines.join('\n');
  }

  return {
    createSetupHubEmbed,
    createDiscordSetupEmbed,
    createEventRemindersSetupEmbed,
    createPlayerToolsEmbed,
    createModUpdatesSetupEmbed,
    createShitterSetupEmbed,
    createReactionRoleSetupEmbed,
    createMayorSetupEmbed,
    createSetupComponents,
    createPlayerToolsComponents,
    createDiscordSetupComponents,
    createMayorSetupComponents,
    createEventRemindersSetupComponents,
    createModUpdatesSetupComponents,
    createShitterSetupComponents,
    createReactionRoleSetupComponents,
    createMayorSetupModal,
    createEventRemindersSetupModal,
    createEventRolePanelEmbed,
    createReactionRoleAddModal,
    createReactionRoleRemoveModal,
    createReactionRolePurgeChannelModal,
    createShitterSetupModal,
    createModUpdatesSetupModal
  };
}

module.exports = { createSetupHubRenderers };
