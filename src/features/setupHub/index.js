const { MessageFlags } = require('discord.js');
const {
  resolveQuickSetupRoles,
  buildRolePanelEntries,
  hasOutdatedPanelEmojis,
  createRolePanelEmbed,
  deleteRolePanels,
  postRolePanel,
  moveTrackedPostsAfterPanels
} = require('./rolePanels');

const { createSetupHubRenderers } = require('./renderers');
const { EVENT_DEFINITIONS } = require('../eventCalendar');
const { MINING_EVENT_DEFINITIONS, getMiningEventDefinitionsForIsland, ISLAND_LABELS } = require('../miningEvents');
const { NO_APP_EMOJIS } = require('../../utils/appEmojis');

const MAYOR_PANEL_DEFINITION = { key: 'mayor', label: 'Mayor Alerts', emoji: '👑', icon: 'sb_mayor_alerts' };
const EVENT_PANEL_MESSAGE_KEYS = ['rolePanelMessageId'];
const MINING_PANELS = [
  { island: 'DWARVEN_MINES', messageKey: 'dwarvenRolePanelMessageId' },
  { island: 'CRYSTAL_HOLLOWS', messageKey: 'crystalRolePanelMessageId' }
];

// The admin overview plus the shared event-calendar and mining role panels; settings are edited in ./editor.js.
function createSetupHub({ store, ensureSetupAccess, mayorAlerts, reactionRoles, interactionIds, appEmojis = NO_APP_EMOJIS }) {
  const panelWarnings = new Map();
  const renderers = createSetupHubRenderers({ store, interactionIds });
  const panelDependencies = { store, reactionRoles };

  function addPanelWarning(guildId, warning) {
    if (warning) panelWarnings.set(guildId, [...(panelWarnings.get(guildId) || []), warning]);
  }

  function createOverviewPayload(guild) {
    return { content: null, embeds: [renderers.createSetupHubEmbed(guild)], components: renderers.createSetupComponents() };
  }

  async function handleSetupCommand(interaction) {
    if (!(await ensureSetupAccess(interaction, 'command'))) {
      return;
    }

    await interaction.reply({ ...createOverviewPayload(interaction.guild), flags: MessageFlags.Ephemeral });
  }

  // Section views moved to the editor; the retired setup-view-* ids that still reach this
  // handler (home, the old Discord view) show the overview.
  async function handleSetupNavigationButton(interaction) {
    if (!(await ensureSetupAccess(interaction, 'setup panel'))) {
      return;
    }

    if (interaction.customId === interactionIds.SETUP_VIEW_PLAYER_TOOLS_ID) {
      await interaction.update({ embeds: [renderers.createPlayerToolsEmbed(interaction.guild)], components: renderers.createPlayerToolsComponents() });
      return;
    }

    await interaction.update(createOverviewPayload(interaction.guild));
  }

  async function resolveQuickSetupEventRoles(guild) {
    const config = store.getGuildConfig(guild.id);
    return resolveQuickSetupRoles(guild, EVENT_DEFINITIONS, config.eventReminders.roles, config.botManagers.roleIds);
  }

  async function resolveQuickSetupMiningEventRoles(guild) {
    const config = store.getGuildConfig(guild.id);
    return resolveQuickSetupRoles(guild, MINING_EVENT_DEFINITIONS, config.miningEvents.roles, config.botManagers.roleIds);
  }

  function getEventPanelEntries(guildId) {
    const config = store.getGuildConfig(guildId);
    return buildRolePanelEntries([...EVENT_DEFINITIONS, MAYOR_PANEL_DEFINITION], { ...config.eventReminders.roles, mayor: config.roleId }, appEmojis);
  }

  function getMiningPanelEntries(guildId, island) {
    return buildRolePanelEntries(getMiningEventDefinitionsForIsland(island), store.getGuildConfig(guildId).miningEvents.roles, appEmojis);
  }

  // Panels posted with other emojis (before the item icons) are rebuilt by the editor's ensurePanels.
  function hasOutdatedEventPanel(guildId, message) {
    return hasOutdatedPanelEmojis(store, guildId, message, getEventPanelEntries(guildId));
  }

  function hasOutdatedMiningPanel(guildId, island, message) {
    return hasOutdatedPanelEmojis(store, guildId, message, getMiningPanelEntries(guildId, island));
  }

  async function deleteEventReminderPosts(guild) {
    const { channelId, messageIds } = store.getGuildRuntimeState(guild.id).eventReminders;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) {
      return;
    }

    for (const messageId of Object.values(messageIds).filter(Boolean)) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      await message?.delete().catch(() => null);
    }
  }

  // Moving or clearing the shared calendar/mayor channel restarts the calendar there. Only channel
  // changes may reset the reminder state: it makes the next check announce every running event again,
  // so the old event pings are removed with the mayor posts.
  async function setEventCalendarChannel(guild, channelId) {
    const config = store.getGuildConfig(guild.id);
    if (config.eventReminders.channelId || config.channelId) {
      await mayorAlerts.deleteTrackedMessagesForGuild(guild.id).catch(() => null);
      await deleteEventReminderPosts(guild);
    }

    await deleteRolePanels({ guild, ...panelDependencies, section: 'eventReminders', messageKeys: EVENT_PANEL_MESSAGE_KEYS });
    store.setGuildConfig(guild.id, { channelId, eventReminders: { ...config.eventReminders, channelId } });

    const state = store.getGuildRuntimeState(guild.id);
    store.setGuildRuntimeState(guild.id, {
      statusMessageId: null,
      statusChannelId: null,
      eventReminders: {
        ...state.eventReminders,
        lastSentStarts: {},
        messageIds: {},
        messageExpireAts: {},
        channelId
      }
    });
  }

  // The event panel is posted first, then the mayor status and calendar posts follow below it.
  async function postEventRolePanelThenStatus(guild) {
    const config = store.getGuildConfig(guild.id);
    const channelId = config.eventReminders.channelId || config.channelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured Event Calendar channel is invalid or not text-based.');
    }

    const entries = getEventPanelEntries(guild.id);
    if (entries.length === 0) {
      throw new Error('Configure at least one event role before posting the role message.');
    }

    await mayorAlerts.deleteTrackedMessagesForGuild(guild.id);
    await deleteRolePanels({ guild, ...panelDependencies, section: 'eventReminders', messageKeys: EVENT_PANEL_MESSAGE_KEYS });
    const { message, warning } = await postRolePanel({
      guild,
      ...panelDependencies,
      channel,
      section: 'eventReminders',
      messageKey: 'rolePanelMessageId',
      entries,
      embed: createRolePanelEmbed({ color: 0x1abc9c, title: 'Event Ping Roles', intro: 'React below to toggle the event ping roles.', entries })
    });
    addPanelWarning(guild.id, warning);
    await mayorAlerts.refreshStatusForGuild(guild.id);
    await moveTrackedPostsAfterPanels({ guild, store, section: 'eventReminders', channelId: channel.id, afterId: message.id });
    return message;
  }

  async function deleteMiningRolePanels(guild) {
    await deleteRolePanels({ guild, ...panelDependencies, section: 'miningEvents', messageKeys: MINING_PANELS.map((panel) => panel.messageKey) });
  }

  // One panel per island, posted above the dashboard and pings in the mining channel.
  async function postMiningRolePanels(guild, channel) {
    await deleteMiningRolePanels(guild);

    let lastPanelId = null;
    for (const { island, messageKey } of MINING_PANELS) {
      const entries = getMiningPanelEntries(guild.id, island);
      if (entries.length === 0) {
        continue;
      }

      const label = ISLAND_LABELS[island];
      const { message, warning } = await postRolePanel({
        guild,
        ...panelDependencies,
        channel,
        section: 'miningEvents',
        messageKey,
        entries,
        embed: createRolePanelEmbed({ color: 0x2ecc71, title: `${label} Mining Event Pings`, intro: `React below to get pinged when a mining event starts in ${label}.`, entries })
      });
      addPanelWarning(guild.id, warning);
      lastPanelId = message.id;
    }

    if (lastPanelId) await moveTrackedPostsAfterPanels({ guild, store, section: 'miningEvents', channelId: channel.id, afterId: lastPanelId });
  }

  return {
    takePanelWarnings(guildId) { const warnings = panelWarnings.get(guildId) || []; panelWarnings.delete(guildId); return warnings; },
    showOverview: (interaction) => interaction.update(createOverviewPayload(interaction.guild)),
    setEventCalendarChannel,
    postEventRolePanelThenStatus,
    resolveQuickSetupEventRoles,
    resolveQuickSetupMiningEventRoles,
    deleteMiningRolePanels,
    postMiningRolePanels,
    hasOutdatedEventPanel,
    hasOutdatedMiningPanel,
    handleSetupCommand,
    handleSetupNavigationButton
  };
}

module.exports = { createSetupHub };
