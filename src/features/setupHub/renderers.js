const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { getHelpSectionById } = require('../../config/help');
const { EVENT_DEFINITIONS } = require('../eventCalendar');
const { WEATHER_ROLE_DEFINITIONS } = require('../weather');

// Section buttons open the settings editor (`admin:open:<section>:<field>`) and the reaction-role editor directly.
function createSetupHubRenderers({ store, interactionIds }) {
  const { SETUP_VIEW_HOME_ID, SETUP_VIEW_PLAYER_TOOLS_ID, REACTION_EDITOR_OPEN_ID } = interactionIds;

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

  function createSetupHubEmbed(guild) {
    const config = store.getGuildConfig(guild.id);
    const stats = getShitterStats(guild.id);
    const calendar = config.eventReminders;
    const mining = config.miningEvents;
    const weather = config.weather;
    const mods = config.modUpdates;
    const sharedChannel = calendar.channelId || config.channelId;
    const eventRoleCount = Object.values(calendar.roles).filter(Boolean).length;
    const miningRoleCount = Object.values(mining.roles).filter(Boolean).length;
    const weatherRoleCount = Object.values(weather.roles).filter(Boolean).length;
    const pingCount = Number(config.mayorAlerts.pingElectionOpen) + Number(config.mayorAlerts.pingMayorChange);
    const channel = id => id ? `<#${id}>` : 'No channel selected';
    const role = id => id ? `<@&${id}>` : 'No ping role';
    const status = (configured, incomplete = false) => configured ? '🟢 Configured' : incomplete ? '🟡 Finish setup' : '⚪ Not set up';
    const nextSteps = [];
    if (!sharedChannel) nextSteps.push('**Event Calendar** → choose a channel for the calendar and mayor status.');
    if (sharedChannel && pingCount && !config.roleId) nextSteps.push('**Mayor Alerts** → choose a role to enable the selected pings.');
    if (calendar.channelId && !eventRoleCount) nextSteps.push('**Event Calendar** → add event roles if you want reminder pings.');
    if (mining.channelId && !miningRoleCount) nextSteps.push('**Mining Events** → use Auto-create event roles to add the mining event roles.');
    if (weather.channelId && !weatherRoleCount) nextSteps.push('**SkyBlock Weather** → use Auto-create event roles or Rebuild posts to add the weather roles.');
    if (mods.channelId && !mods.trackedRepos.length) nextSteps.push('**Mod Updates** → add a repository to start tracking releases.');

    const embed = new EmbedBuilder()
      .setColor(nextSteps.length ? 0xe0a526 : 0x3498db)
      .setTitle('Admin Overview')
      .setAuthor({ name: guild.name })
      .setDescription('Choose a section to select channels and roles, rebuild bot posts or reset settings.')
      .addFields(
        {
          name: 'Event Calendar',
          value: `${status(Boolean(calendar.channelId))}\nCalendar: ${channel(calendar.channelId)}\nPing roles: ${eventRoleCount}/${EVENT_DEFINITIONS.length}`,
          inline: true
        },
        {
          name: 'Mayor Alerts',
          value: `${status(Boolean(sharedChannel && (!pingCount || config.roleId)), Boolean(sharedChannel || config.roleId))}\nStatus: ${channel(sharedChannel)}\n${role(config.roleId)}\nBooth ping: ${config.mayorAlerts.pingElectionOpen ? 'On' : 'Off'} · Mayor ping: ${config.mayorAlerts.pingMayorChange ? 'On' : 'Off'}`,
          inline: true
        },
        {
          name: 'Mining Events',
          value: `${status(Boolean(mining.channelId && miningRoleCount), Boolean(mining.channelId || miningRoleCount))}\n${channel(mining.channelId)}\nPing roles: ${miningRoleCount}`,
          inline: true
        },
        {
          name: 'SkyBlock Weather',
          value: `${status(Boolean(weather.channelId && weatherRoleCount), Boolean(weather.channelId || weatherRoleCount))}\n${channel(weather.channelId)}\nPing roles: ${weatherRoleCount}/${WEATHER_ROLE_DEFINITIONS.length}`,
          inline: true
        },
        {
          name: 'Mod Updates',
          value: `${status(Boolean(mods.channelId && mods.trackedRepos.length), Boolean(mods.channelId))}\n${channel(mods.channelId)}\nRepositories: ${mods.trackedRepos.length}\n${mods.roleId ? role(mods.roleId) : 'Pings off'}`,
          inline: true
        },
        {
          name: 'Reaction Roles',
          value: `${config.reactionRoles.length} bindings\nAcross ${new Set(config.reactionRoles.map(binding => binding.messageId).filter(Boolean)).size} messages\nManage roles assigned through reactions.`,
          inline: true
        },
        {
          name: 'Shitter List',
          value: `${stats.activeNames} active names · ${stats.activeEntries} entries\nAllowed roles: ${config.shitterPermissions.allowedRoleIds.length || 'Everyone'}\nBlocked: ${config.shitterPermissions.blockedUserIds.length} users · ${config.shitterPermissions.blockedRoleIds.length} roles`,
          inline: true
        },
        {
          name: 'Voice',
          value: `TTS role: ${config.tts.roleId ? `<@&${config.tts.roleId}>` : 'Not selected'}\nServer voice: ${config.tts.voice ? `\`${config.tts.voice}\`` : 'Default'}\nMusic: ${channel(config.music.controlChannelId)}\nVolume: ${config.music.volume}% · Stations: ${config.music.stations.length}`,
          inline: true
        },
        {
          name: nextSteps.length ? 'Next steps' : 'Manage your server',
          value: nextSteps.length ? nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n') : 'Choose a section to adjust settings, or open Player Tools for the command guide.'
        }
      )
      .setFooter({ text: `${guild.client?.user?.username || 'Bot'} • Saved configuration • Only visible to you` });
    return embed;
  }

  function createPlayerToolsEmbed(guild) {
    const playerToolsSection = getHelpSectionById('player-tools');
    const shitterStats = getShitterStats(guild.id);
    const description = [
      'These commands do not need extra setup, but they are some of the most useful player-facing tools in the bot.',
      'Use this page as a quick reference for moderators and staff.',
      'Anyone can also use `/help` for the public command guide.'
    ];

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Admin • Player Tools')
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

  function createSetupComponents() {
    const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
      .setCustomId(id).setLabel(label).setStyle(style);
    return [
      new ActionRowBuilder().addComponents(
        button('admin:open:calendar:channel', 'Event Calendar', ButtonStyle.Primary),
        button('admin:open:mayor:channel', 'Mayor Alerts'),
        button('admin:open:mining:channel', 'Mining Events'),
        button('admin:open:weather:channel', 'Weather')
      ),
      new ActionRowBuilder().addComponents(
        button('admin:open:mods:channel', 'Mod Updates'),
        button(REACTION_EDITOR_OPEN_ID, 'Reaction Roles'),
        button('admin:open:shitter:allowedRoleIds', 'Shitter List'),
        button('admin:open:voice:role', 'Voice')
      ),
      new ActionRowBuilder().addComponents(
        button('admin:open:access:userIds', 'Bot Access'),
        button(SETUP_VIEW_PLAYER_TOOLS_ID, 'Player Tools'),
        button(SETUP_VIEW_HOME_ID, 'Refresh overview')
      )
    ];
  }

  function createPlayerToolsComponents() {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SETUP_VIEW_HOME_ID).setLabel('Admin Overview').setStyle(ButtonStyle.Secondary)
    )];
  }

  return {
    createSetupHubEmbed,
    createPlayerToolsEmbed,
    createSetupComponents,
    createPlayerToolsComponents
  };
}

module.exports = { createSetupHubRenderers };
