const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  RoleSelectMenuBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, EmbedBuilder,
  PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { EVENT_DEFINITIONS } = require('../eventCalendar');
const { MINING_EVENT_DEFINITIONS, getMiningEventDefinitionsForIsland, ISLAND_LABELS } = require('../miningEvents');
const { WEATHER_CHANNEL_NAME } = require('../weather');
const { pinRolePanel, validatePanelRole } = require('./rolePanels');
const { interactionIds } = require('../../config/interactionIds');

// Every section function receives the editor dependencies ({ store, setupHub, weather, modUpdates, miningEvents }).
function setSectionChannel({ store }, guild, configKey, channelId) {
  store.setGuildConfig(guild.id, { [configKey]: { ...store.getGuildConfig(guild.id)[configKey], channelId } });
}
const eventChannelOf = config => config.eventReminders.channelId || config.channelId;
const resolveEventRoles = ({ setupHub }, guild) => setupHub.resolveQuickSetupEventRoles(guild);
const moveEventChannel = ({ setupHub }, guild, channelId) => setupHub.setEventCalendarChannel(guild, channelId);
// configKey: config entry of the section; channelOf: its target channel; hasPanels: owns pinned role panels
// (role fields are panel roles named roleLabel); quickSetup: resolves the panel roles; autoCreate: offers that as a button.
const SECTIONS = {
  mayor: { title: 'Mayor Alerts', fields: [['channel', 'Calendar / mayor channel', 'channel'], ['role', 'Mayor ping role', 'role']],
    configKey: 'eventReminders', channelOf: eventChannelOf, channelName: 'mayor-channel', moveChannel: moveEventChannel, hasPanels: true, roleLabel: 'mayor ping role', quickSetup: resolveEventRoles },
  calendar: { title: 'Event Calendar', fields: [['channel', 'Calendar / mayor channel', 'channel'], ...EVENT_DEFINITIONS.map(e => [e.key, e.label, 'role'])],
    configKey: 'eventReminders', channelOf: eventChannelOf, channelName: 'event-calendar', moveChannel: moveEventChannel, hasPanels: true, roleLabel: 'event ping role', quickSetup: resolveEventRoles, autoCreate: true },
  mining: { title: 'Mining Events', fields: [['channel', 'Event channel', 'channel'], ...MINING_EVENT_DEFINITIONS.map(e => [e.key, `${e.label} — ${ISLAND_LABELS[e.island]}`, 'role'])],
    configKey: 'miningEvents', channelOf: config => config.miningEvents.channelId, channelName: 'mining-events', hasPanels: true, roleLabel: 'mining event ping role', autoCreate: true,
    quickSetup: ({ setupHub }, guild) => setupHub.resolveQuickSetupMiningEventRoles(guild),
    async moveChannel(deps, guild, channelId) {
      await deps.miningEvents.deleteTrackedMiningEventMessages(guild.id);
      await deps.setupHub.deleteMiningRolePanels(guild);
      setSectionChannel(deps, guild, 'miningEvents', channelId);
    } },
  weather: { title: 'SkyBlock Weather', fields: [['channel', 'Weather channel', 'channel'], ['mild', 'Mild weather ping role', 'role'], ['extreme', 'EXTREME weather ping role', 'role']],
    configKey: 'weather', channelOf: config => config.weather.channelId, channelName: WEATHER_CHANNEL_NAME, hasPanels: true, roleLabel: 'weather ping role', autoCreate: true,
    quickSetup: ({ weather }, guild) => weather.resolveQuickSetupWeatherRoles(guild),
    async moveChannel(deps, guild, channelId) {
      await deps.weather.deleteTrackedWeatherMessages(guild.id);
      await deps.weather.deleteWeatherRolePanel(guild);
      setSectionChannel(deps, guild, 'weather', channelId);
    } },
  mods: { title: 'Mod Updates', fields: [['channel', 'Release channel', 'channel'], ['role', 'Ping role', 'role']],
    configKey: 'modUpdates', channelOf: config => config.modUpdates.channelId, channelName: 'mod-updates',
    async moveChannel(deps, guild, channelId) {
      await deps.modUpdates.deleteTrackedStatusMessages(guild.id);
      setSectionChannel(deps, guild, 'modUpdates', channelId);
    } },
  shitter: { title: 'Shitter Permissions', fields: [['allowedRoleIds', 'Allowed roles', 'roles'], ['blockedRoleIds', 'Blocked roles', 'roles'], ['blockedUserIds', 'Blocked users', 'users']], configKey: 'shitterPermissions' },
  access: { title: 'Bot Access', fields: [['userIds', 'Bot managers', 'users'], ['roleIds', 'Bot manager roles', 'roles']], configKey: 'botManagers' }
};
// Buttons of the retired setup views; panels still open in Discord keep working.
const LEGACY_ROUTES = {
  'setup-view-mayor': 'admin:open:mayor:channel',
  'setup-mayor-edit': 'admin:open:mayor:role',
  'setup-view-event-reminders': 'admin:open:calendar:channel',
  'setup-event-reminders-modal': 'admin:open:calendar:channel',
  'setup-view-mining-events': 'admin:open:mining:channel',
  'setup-view-weather': 'admin:open:weather:channel',
  'setup-view-mod-updates': 'admin:open:mods:channel',
  'setup-mod-updates-modal': 'admin:open:mods:channel',
  'setup-view-shitter': 'admin:open:shitter:allowedRoleIds',
  'setup-shitter-modal': 'admin:open:shitter:allowedRoleIds'
};
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const id = (action, section, field = 'channel') => `admin:${action}:${section}:${field}`;

function createSetupEditor({ store, accessControl, setupHub, mayorAlerts, modUpdates, miningEvents, pagedLists, weather }) {
  const deps = { store, setupHub, weather, modUpdates, miningEvents };
  const busy = new Set();
  const confirmations = new Map();
  const weatherWarnings = new Map();
  function read(config, section, field) {
    const entry = config[SECTIONS[section].configKey];
    if (section === 'access' || section === 'shitter') return entry[field];
    if (field === 'channel') return SECTIONS[section].channelOf(config);
    if (section === 'mayor') return config.roleId;
    if (field === 'role') return entry.roleId;
    return entry.roles[field];
  }
  async function requireBotPermission(guild, permission, message) {
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(PermissionsBitField.Flags[permission])) throw new Error(message);
    return me;
  }
  function render(guild, section, field = SECTIONS[section].fields[0][0], note = '', mode = 'add') {
    const definition = SECTIONS[section];
    const selected = definition.fields.find(f => f[0] === field) || definition.fields[0];
    field = selected[0];
    const config = store.getGuildConfig(guild.id);
    const value = read(config, section, field);
    const format = (value, type) => {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      return list.length ? list.map(v => type === 'channel' ? `<#${v}>` : type === 'users' ? `<@${v}>` : `<@&${v}>`).join(', ') : 'Not selected';
    };
    const intro = `Select a setting, then choose its channel, role or users. Changes save immediately.${definition.hasPanels ? ' Role panels are posted first and pinned when the bot has permission.' : ''}`;
    const embed = new EmbedBuilder().setTitle(`Admin • ${definition.title}`).setColor(0x3498db)
      .setDescription([intro, note].filter(Boolean).join('\n\n'))
      .addFields({ name: selected[1], value: Array.isArray(value) ? `${value.length} selected. Use View all to see every entry.` : format(value, selected[2]) })
      .setFooter({ text: 'Only visible to you • Configure any target channel the bot can use' });
    if (section === 'access') embed.addFields({ name: 'Bot managers can', value: 'Change bot channels, pings and moderation settings; rebuild bot posts and reset modules. Access grants and reaction-role bindings remain restricted to server administrators.' });
    if (section === 'mayor' || section === 'calendar') embed.addFields({ name: 'Shared channel', value: 'The pinned event-role panel appears first in this channel, followed by the mayor status and event calendar. Moving the channel moves them together.' });
    if (section === 'shitter' && field === 'allowedRoleIds') embed.addFields({ name: 'Empty selection', value: 'Everyone can use the list, except blocked users and roles.' });
    if (section === 'mods') embed.addFields({ name: 'Repositories', value: `${config.modUpdates.trackedRepos.length} repositories. Use View all to browse the complete list.` });
    if (section === 'weather') embed.addFields({ name: 'Current weather', value: weather?.getWeatherSummary() || 'Unavailable' },
      { name: 'Schedule', value: 'Calculated locally: weather every hour from XX:35 to XX:55, every 3rd window is EXTREME. Mild and EXTREME roles are pinged separately; a live dashboard stays below the pinned role panel.' });
    const settingMenu = new StringSelectMenuBuilder().setCustomId(id('field', section, field)).setPlaceholder('Choose a setting')
      .addOptions(definition.fields.map(([key, label]) => ({ label, value: key, default: key === field })));
    const multi = ['roles', 'users'].includes(selected[2]);
    let picker;
    if (selected[2] === 'channel') {
      picker = new ChannelSelectMenuBuilder().addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
      if (value) picker.setDefaultChannels(value);
    } else if (selected[2] === 'users') {
      picker = new UserSelectMenuBuilder();

    } else {
      picker = new RoleSelectMenuBuilder();
      const values = Array.isArray(value) ? value : value ? [value] : [];
      if (!multi && values.length) picker.setDefaultRoles(values);
    }
    picker.setCustomId(id(multi && mode === 'remove' ? 'removeitems' : 'save', section, field)).setPlaceholder(`${multi ? mode === 'remove' ? 'Remove from' : 'Add to' : 'Choose'} ${selected[1].toLowerCase()}`).setMinValues(0).setMaxValues(multi ? 25 : 1);
    const actions = [];
    if (multi) actions.push(button(id(mode === 'remove' ? 'open' : 'removemode', section, field), mode === 'remove' ? 'Add entries' : 'Remove entries'));
    if (multi || section === 'mods') actions.push(button(id('all', section, field), 'View all'));
    if (selected[2] === 'channel') actions.push(button(id('create', section, field), 'Create new channel'));
    if (definition.channelOf) actions.push(button(id('rebuild', section, field), 'Rebuild posts'));
    if (definition.autoCreate) actions.push(button(id('auto', section, field), 'Auto-create event roles'));
    if (section === 'mods') actions.push(button(id('repos', section, field), 'Add repositories'), button(id('removerepos', section, field), 'Remove repositories'));
    if (section === 'mayor') actions.push(
      button(id('booth', section, field), `Booth ping: ${config.mayorAlerts.pingElectionOpen ? 'On' : 'Off'}`),
      button(id('mayorping', section, field), `Mayor ping: ${config.mayorAlerts.pingMayorChange ? 'On' : 'Off'}`));
    return { content: null, embeds: [embed], components: [row(settingMenu), row(picker), ...(actions.length ? [row(...actions.slice(0, 5)), ...(actions.length > 5 ? [row(...actions.slice(5))] : [])] : []),
      row(button(id('reset', section, field), 'Reset section', ButtonStyle.Danger), button(interactionIds.SETUP_VIEW_HOME_ID, 'Admin Overview'))], allowedMentions: { parse: [] } };
  }
  async function validateChannel(guild, channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Choose a text channel in this server.');
    const me = guild.members.me || await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];
    const missing = needed.filter(p => !permissions?.has(PermissionsBitField.Flags[p]));
    if (missing.length) throw new Error(`The bot needs ${missing.join(', ')} in that channel.`);
    return channel;
  }
  async function validateRoles(guild, values) {
    for (const value of values) {
      const role = await guild.roles.fetch(value).catch(() => null);
      if (!role || role.id === guild.id || role.managed) throw new Error('Choose a regular role from this server, not @everyone or a managed bot role.');
    }
  }
  async function save(guild, section, field, values, remove = false) {
    const definition = SECTIONS[section];
    const config = store.getGuildConfig(guild.id);
    const entry = config[definition.configKey];
    const value = values[0] || null;
    if (section === 'access' || section === 'shitter') {
      store.setGuildConfig(guild.id, { [definition.configKey]: { ...entry, [field]: remove ? entry[field].filter(id => !values.includes(id)) : [...new Set([...entry[field], ...values])] } });
    } else if (field === 'channel') {
      await definition.moveChannel(deps, guild, value);
    } else if (definition.hasPanels) {
      // Role fields only change the roles; the panel is rebuilt afterwards and reminder state stays untouched.
      if (value) await validatePanelRole(guild, value, config.botManagers.roleIds, definition.roleLabel);
      if (section === 'mayor') store.setGuildConfig(guild.id, { roleId: value });
      else store.setGuildConfig(guild.id, { [definition.configKey]: { ...entry, roles: { ...entry.roles, [field]: value } } });
    } else {
      store.setGuildConfig(guild.id, { [definition.configKey]: { ...entry, roleId: value } });
    }
  }
  async function rebuild(guild, section) {
    const definition = SECTIONS[section];
    let config = store.getGuildConfig(guild.id);
    const channelId = definition.channelOf(config);
    if (!channelId) throw new Error('Select a target channel first.');
    const channel = await validateChannel(guild, channelId);
    if (section === 'mods') {
      if (!config.modUpdates.trackedRepos.length) throw new Error('Add a repository first.');
      await modUpdates.deleteTrackedStatusMessages(guild.id);
      await modUpdates.syncStatusMessage(guild.id);
      return;
    }
    const { configKey } = definition;
    if (!Object.values(config[configKey].roles).some(Boolean)) {
      await requireBotPermission(guild, 'ManageRoles', `Channel saved. The bot needs Manage Roles to create the initial ${section === 'weather' ? 'weather' : 'event'} roles and panel.`);
      const { roles } = await definition.quickSetup(deps, guild);
      store.setGuildConfig(guild.id, { [configKey]: { ...config[configKey], roles } });
      config = store.getGuildConfig(guild.id);
    }
    if (section === 'weather') {
      await validatePanelRoles(guild, channel, config.weather.roles, definition.roleLabel);
      const { warnings } = await weather.postWeatherRolePanel(guild, channel, config.weather.roles);
      if (warnings.length) weatherWarnings.set(guild.id, [...(weatherWarnings.get(guild.id) || []), ...warnings]);
      await weather.syncWeatherDashboard(guild.id);
    } else if (section === 'mining') {
      await validatePanelRoles(guild, channel, config.miningEvents.roles, definition.roleLabel);
      await setupHub.postMiningRolePanels(guild, channel);
    } else if (Object.values(config.eventReminders.roles).some(Boolean) || config.roleId) {
      await validatePanelRoles(guild, channel, { ...config.eventReminders.roles, mayor: config.roleId }, SECTIONS.calendar.roleLabel);
      await setupHub.postEventRolePanelThenStatus(guild);
    } else {
      await mayorAlerts.deleteTrackedMessagesForGuild(guild.id);
      await mayorAlerts.refreshStatusForGuild(guild.id);
    }
  }
  async function validatePanelRoles(guild, channel, roles, roleLabel) {
    const me = guild.members.me || await guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has(PermissionsBitField.Flags.AddReactions) || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) throw new Error('The bot needs Add Reactions and Manage Roles to build role panels.');
    const managerRoleIds = store.getGuildConfig(guild.id).botManagers.roleIds;
    for (const roleId of Object.values(roles).filter(Boolean)) await validatePanelRole(guild, roleId, managerRoleIds, roleLabel);
  }
  async function reset(guild, section) {
    if (section === 'mayor') store.setGuildConfig(guild.id, { roleId: null, mayorAlerts: { pingElectionOpen: false, pingMayorChange: false } });
    if (section === 'calendar') {
      await setupHub.setEventCalendarChannel(guild, null);
      store.setGuildConfig(guild.id, { eventReminders: { ...store.getGuildConfig(guild.id).eventReminders, roles: {} } });
    }
    if (section === 'mining') {
      await miningEvents.deleteTrackedMiningEventMessages(guild.id);
      await setupHub.deleteMiningRolePanels(guild);
      store.setGuildConfig(guild.id, { miningEvents: { channelId: null, roles: {} } });
    }
    if (section === 'weather') {
      store.setGuildConfig(guild.id, { weather: { channelId: null, roles: {} } });
      await weather.deleteWeatherRolePanel(guild);
      await weather.deleteTrackedWeatherMessages(guild.id);
    }
    if (section === 'mods') {
      await modUpdates.deleteTrackedStatusMessages(guild.id);
      store.setGuildConfig(guild.id, { modUpdates: { channelId: null, roleId: null, trackedRepos: [] } });
    }
    if (section === 'shitter') store.setGuildConfig(guild.id, { shitterPermissions: { blockedUserIds: [], blockedRoleIds: [], allowedRoleIds: [] } });
    if (section === 'access') store.setGuildConfig(guild.id, { botManagers: { userIds: [], roleIds: [] } });
  }
  async function handle(interaction) {
    const customId = interaction.isButton?.() ? LEGACY_ROUTES[interaction.customId] || interaction.customId : interaction.customId;
    if (!customId?.startsWith('admin:')) return false;
    const [, action, section, requestedField] = customId.split(':');
    if (!SECTIONS[section]) return false;
    const ensure = section === 'access' ? accessControl.ensureServerAccess : accessControl.ensureSetupAccess;
    if (!(await ensure(interaction, 'settings panel'))) return true;
    const field = SECTIONS[section].fields.some(f => f[0] === requestedField) ? requestedField : SECTIONS[section].fields[0][0];
    if (action === 'all') {
      const config = store.getGuildConfig(interaction.guildId);
      const type = SECTIONS[section].fields.find(f => f[0] === field)[2];
      const values = section === 'mods' ? config.modUpdates.trackedRepos : read(config, section, field);
      await pagedLists.open(interaction, { title: `${SECTIONS[section].title} — All entries`, lines: (Array.isArray(values) ? values : values ? [values] : []).map((value, index) => `${index + 1}. ${section === 'mods' ? value : type === 'users' ? `<@${value}>` : `<@&${value}>`}`), guard: ensure, back: id('open', section, field) });
      return true;
    }
    if (action === 'removemode') {
      await interaction.update(render(interaction.guild, section, field, 'Select the entries to remove. Other entries stay unchanged.', 'remove'));
      return true;
    }
    if (action === 'open' || action === 'field') {
      await interaction.update(render(interaction.guild, section, action === 'field' ? interaction.values[0] : field));
      return true;
    }
    if (['repos', 'removerepos'].includes(action) && section === 'mods') {
      const modal = new ModalBuilder().setCustomId(id(action === 'repos' ? 'saverepos' : 'deleterepos', section, field)).setTitle(action === 'repos' ? 'Add repositories' : 'Remove repositories')
        .addComponents(row(new TextInputBuilder().setCustomId('repos').setLabel('One GitHub repository per line').setStyle(TextInputStyle.Paragraph).setRequired(false)
          .setPlaceholder('https://github.com/owner/repository')));
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'reset' || action === 'create' || action === 'auto') {
      const resetText = { mayor: 'Clear the mayor ping role and turn off both pings. The shared calendar channel stays configured.', calendar: 'Disable the shared calendar and mayor status, and clear event roles and role-panel settings.', mining: 'Disable mining alerts and clear their channel and event roles.', weather: 'Disable weather pings and the live dashboard, remove the role panel, and clear the weather channel and roles.', mods: 'Disable mod updates and clear the channel, ping role and repositories.', shitter: 'Clear all restrictions. Everyone will be allowed to use the list; existing entries remain.', access: 'Remove every delegated bot manager. Server administrators keep access.' };
      const text = action === 'reset' ? resetText[section] : action === 'create' ? 'Create a new text channel next to the other bot channels and select it for this setting. Existing channels will not be deleted.' : 'Reuse matching event roles or create missing ones. The role panels will be built first and pinned in the configured channel.';
      const token = require('node:crypto').randomBytes(8).toString('hex');
      for (const [key, entry] of confirmations) if (entry.expires < Date.now()) confirmations.delete(key);
      confirmations.set(token, { action, section, field, guildId: interaction.guildId, userId: interaction.user.id, expires: Date.now() + 5 * 60_000 });
      await interaction.update({ content: null, embeds: [new EmbedBuilder().setTitle('Confirm change').setDescription(text).setColor(0xe0a526)], components: [row(button(id(`confirm-${token}`, section, field), 'Confirm', action === 'reset' ? ButtonStyle.Danger : ButtonStyle.Primary), button(id('open', section, field), 'Cancel'))] });
      return true;
    }
    await interaction.deferUpdate();
    if (busy.has(interaction.guildId)) {
      await interaction.editReply(render(interaction.guild, section, field, 'Another change is being saved. Try again in a moment.'));
      return true;
    }
    busy.add(interaction.guildId);
    let note = 'Saved.';
    // Weather changes share the per-guild lock of the weather service with its 60 s check loop.
    const serialize = section === 'weather' ? task => weather.withGuildLock(interaction.guildId, task) : task => task();
    try {
      await serialize(async () => {
        let confirmedAction = null;
        if (action.startsWith('confirm-')) {
          const token = action.slice(8);
          const entry = confirmations.get(token);
          if (!entry || entry.guildId !== interaction.guildId || entry.userId !== interaction.user.id || entry.section !== section || entry.field !== field || entry.expires < Date.now()) throw new Error('Confirmation expired. Open the action again.');
          confirmations.delete(token);
          confirmedAction = entry.action;
        }
        if (action === 'save' || action === 'removeitems') {
          const type = SECTIONS[section].fields.find(f => f[0] === field)[2];
          const values = interaction.values;
          if (!Array.isArray(values) || values.length > (['roles', 'users'].includes(type) ? 25 : 1) || values.some(v => !/^\d{16,20}$/.test(v))) throw new Error('Invalid selection.');
          if (type === 'channel' && values[0]) await validateChannel(interaction.guild, values[0]);
          if (type === 'role' || type === 'roles') await validateRoles(interaction.guild, values);
          if (type === 'users') for (const value of values) if (!(await interaction.guild.members.fetch(value).catch(() => null))) throw new Error('Choose a member of this server.');
          if (action === 'removeitems' && !['roles', 'users'].includes(type)) throw new Error('This setting is not a list.');
          await save(interaction.guild, section, field, values, action === 'removeitems');
          await rebuildIfConfigured(interaction.guild, section);
        } else if (action === 'rebuild') { await rebuild(interaction.guild, section); note = 'Bot posts rebuilt in the configured channel.'; }
        else if (['saverepos', 'deleterepos'].includes(action) && section === 'mods') {
          const trackedRepos = modUpdates.parseTrackedReposInput(interaction.fields.getTextInputValue('repos')).map(r => r.url);
          const config = store.getGuildConfig(interaction.guildId);
          store.setGuildConfig(interaction.guildId, { modUpdates: { ...config.modUpdates, trackedRepos: action === 'deleterepos' ? config.modUpdates.trackedRepos.filter(repo => !trackedRepos.includes(repo)) : [...new Set([...config.modUpdates.trackedRepos, ...trackedRepos])] } });
        } else if (['booth', 'mayorping'].includes(action) && section === 'mayor') {
          const config = store.getGuildConfig(interaction.guildId);
          const key = action === 'booth' ? 'pingElectionOpen' : 'pingMayorChange';
          store.setGuildConfig(interaction.guildId, { mayorAlerts: { ...config.mayorAlerts, [key]: !config.mayorAlerts[key] } });
        } else if (confirmedAction === 'reset') { await reset(interaction.guild, section); note = 'Section reset. Discord channels and roles were kept.'; }
        else if (confirmedAction === 'create') {
          if (SECTIONS[section].fields.find(f => f[0] === field)[2] !== 'channel') throw new Error('Select a channel setting first.');
          await requireBotPermission(interaction.guild, 'ManageChannels', 'The bot needs Manage Channels to create a channel.');
          const parent = (await weather?.findBotChannelCategoryId(interaction.guild, interaction.channel)) ?? undefined;
          const channel = await interaction.guild.channels.create({ name: SECTIONS[section].channelName, type: ChannelType.GuildText, parent, reason: `Bot setup requested by ${interaction.user.id}` });
          note = `Created <#${channel.id}>.`;
          await validateChannel(interaction.guild, channel.id);
          await save(interaction.guild, section, field, [channel.id]);
          await rebuildIfConfigured(interaction.guild, section);
        } else if (confirmedAction === 'auto' && SECTIONS[section].autoCreate) {
          await requireBotPermission(interaction.guild, 'ManageRoles', 'The bot needs Manage Roles to create event roles.');
          const result = await SECTIONS[section].quickSetup(deps, interaction.guild);
          const { configKey } = SECTIONS[section];
          const config = store.getGuildConfig(interaction.guildId);
          store.setGuildConfig(interaction.guildId, { [configKey]: { ...config[configKey], roles: result.roles } });
          await rebuildIfConfigured(interaction.guild, section);
          note = `Event roles saved; ${result.createdCount} created. Panels were built if a target channel is configured.`;
        } else throw new Error('Unknown action. Reopen the panel.');
      });
    } catch (error) {
      note = `Could not finish: ${error.message}`;
    } finally { busy.delete(interaction.guildId); }
    const warnings = [...setupHub.takePanelWarnings(interaction.guildId), ...(weatherWarnings.get(interaction.guildId) || [])];
    weatherWarnings.delete(interaction.guildId);
    await interaction.editReply(render(interaction.guild, section, field, [note, ...warnings].join('\n')));
    return true;
  }
  async function rebuildIfConfigured(guild, section) {
    if (SECTIONS[section].hasPanels && SECTIONS[section].channelOf(store.getGuildConfig(guild.id))) await rebuild(guild, section);
  }
  async function ensurePanels(guild) {
    for (const section of ['calendar', 'mining']) {
      try {
        const config = store.getGuildConfig(guild.id);
        const { configKey, channelOf } = SECTIONS[section];
        const channelId = channelOf(config);
        if (!channelId) continue;
        const state = store.getGuildRuntimeState(guild.id);
        const runtime = state[configKey];
        const channel = await guild.channels.fetch(channelId);
        const panels = section === 'calendar'
          ? [{ messageId: runtime.rolePanelMessageId, isOutdated: message => setupHub.hasOutdatedEventPanel(guild.id, message) }]
          : [['DWARVEN_MINES', runtime.dwarvenRolePanelMessageId], ['CRYSTAL_HOLLOWS', runtime.crystalRolePanelMessageId]]
            .filter(([island]) => getMiningEventDefinitionsForIsland(island).some(e => config[configKey].roles[e.key]))
            .map(([island, messageId]) => ({ messageId, isOutdated: message => setupHub.hasOutdatedMiningPanel(guild.id, island, message) }));
        const messages = await Promise.all(panels.map(({ messageId }) => messageId ? channel.messages.fetch(messageId).catch(() => null) : null));
        const trackedIds = section === 'calendar'
          ? [state.statusChannelId === channelId ? state.statusMessageId : null, ...(runtime.channelId === channelId ? Object.values(runtime.messageIds) : [])]
          : [runtime.dashboardMessageId, ...Object.values(runtime.pingMessageIds)];
        const reversed = messages.some(message => message && trackedIds.some(postId => postId && BigInt(postId) < BigInt(message.id)));
        const outdated = messages.some((message, index) => panels[index].isOutdated(message));
        if (!messages.length || messages.some(message => !message || message.author?.id !== guild.client.user.id) || reversed || outdated) {
          await rebuild(guild, section);
        } else {
          for (const message of messages) {
            const warning = await pinRolePanel(message);
            if (warning) console.warn(warning);
          }
        }
        for (const warning of setupHub.takePanelWarnings(guild.id)) console.warn(warning);
      } catch (error) { console.warn(`Role panels for ${section} in ${guild.id}: ${error.message}`); }
    }
    try {
      if (store.getGuildConfig(guild.id).weather.channelId) await weather.ensureWeatherRolePanel(guild);
    } catch (error) { console.warn(`Role panels for weather in ${guild.id}: ${error.message}`); }
  }
  return { handle, render, validateChannel, ensurePanels };
}
module.exports = { createSetupEditor, SECTIONS };
