const { EmbedBuilder } = require('discord.js');

const { env } = require('../config/env');
const { NO_APP_EMOJIS } = require('../utils/appEmojis');
const {
  ISLAND_EMOJIS,
  ISLAND_ICONS,
  ISLAND_LABELS,
  MINING_EVENT_DEFINITIONS,
  MINING_EVENT_DEFINITION_MAP,
  getMiningEventDefinitionsForIsland
} = require('../config/miningEventDefinitions');

const SOOPY_CHEVENTS_URL = 'https://api.soopy.dev/skyblock/chevents/get';

// An occurrence is tracked by its last sighting in the feed. The grace window
// keeps it alive when the API briefly drops it, which would otherwise look like
// a new start.
const ACTIVE_EVENT_GRACE_MS = 3 * 60 * 1000;
const DOUBLE_EVENT_REPEAT_DELAY_MS = 15 * 60 * 1000;

const DASHBOARD_COLOR = 0x9b59b6;

async function fetchRunningMiningEvents() {
  const response = await fetch(SOOPY_CHEVENTS_URL, {
    headers: { 'User-Agent': env.USER_AGENT },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Soopy chevents request failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.success !== true || !payload.data || typeof payload.data !== 'object') {
    throw new Error('Soopy chevents returned an invalid response.');
  }

  return payload.data.running_events && typeof payload.data.running_events === 'object'
    ? payload.data.running_events
    : {};
}

function findRunningEntry(runningEvents, definition) {
  const islandEvents = Array.isArray(runningEvents?.[definition.island]) ? runningEvents[definition.island] : [];
  return islandEvents.find((entry) => entry?.event === definition.soopyKey) || null;
}

function formatLobbyCount(lobbyCount) {
  if (!Number.isInteger(lobbyCount) || lobbyCount < 0) {
    return 'an unknown number of lobbies';
  }

  return `${lobbyCount} ${lobbyCount === 1 ? 'lobby' : 'lobbies'}`;
}

function getIslandIcon(island, appEmojis = NO_APP_EMOJIS) {
  return appEmojis.get(ISLAND_ICONS[island], ISLAND_EMOJIS[island]);
}

function getMiningEventIcon(definition, appEmojis = NO_APP_EMOJIS) {
  return appEmojis.get(definition.icon, definition.emoji);
}

function createMiningEventPingDescription(definition, lobbyCount, appEmojis = NO_APP_EMOJIS) {
  return [
    `Island: ${getIslandIcon(definition.island, appEmojis)} ${ISLAND_LABELS[definition.island]}`,
    `Observed in ${formatLobbyCount(lobbyCount)} so far`
  ].join('\n');
}

// Titles do not render custom emojis, so the item icon is the thumbnail instead.
function createMiningEventPingEmbed(definition, lobbyCount = null, { isRepeat = false, appEmojis = NO_APP_EMOJIS } = {}) {
  const embed = new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(`${definition.label} is ACTIVE${isRepeat ? ' AGAIN' : ''}`)
    .setDescription(createMiningEventPingDescription(definition, lobbyCount, appEmojis))
    .setTimestamp();

  const iconUrl = definition.icon ? appEmojis.url(definition.icon) : null;
  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }

  return embed;
}

// Islands are headings in the description, because field names do not render custom emojis.
function createMiningEventsDashboardEmbed(activeEntries, { appEmojis = NO_APP_EMOJIS } = {}) {
  const sections = Object.keys(ISLAND_LABELS)
    .map((island) => {
      const islandEntries = activeEntries.filter((entry) => entry.definition.island === island);
      if (islandEntries.length === 0) {
        return null;
      }

      return [
        `**${getIslandIcon(island, appEmojis)} ${ISLAND_LABELS[island]}**`,
        ...islandEntries.map(({ definition, lobbyCount, isDouble }) =>
          `${getMiningEventIcon(definition, appEmojis)} **${definition.label}** — Observed in ${formatLobbyCount(lobbyCount)} so far${isDouble ? ' · **Double event**' : ''}`)
      ].join('\n');
    })
    .filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(DASHBOARD_COLOR)
    .setTitle('Active Mining Events')
    .setTimestamp();

  if (sections.length > 0) {
    embed.setDescription(sections.join('\n\n'));
  }

  return embed;
}

function createMiningEventsService({ client, store, appEmojis = NO_APP_EMOJIS }) {
  function updateMiningRuntimeState(guildId, patch) {
    store.updateGuildRuntimeSection(guildId, 'miningEvents', patch);
  }

  async function deletePreviousMiningEventPing(guildId, channel, definition) {
    const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
    const previousMessageId = runtimeState.pingMessageIds[definition.key] || null;
    if (!previousMessageId) {
      return;
    }

    const previousChannel = runtimeState.pingChannelId && runtimeState.pingChannelId !== channel.id
      ? await client.channels.fetch(runtimeState.pingChannelId).catch(() => null)
      : channel;

    if (previousChannel && previousChannel.isTextBased()) {
      const previousMessage = await previousChannel.messages.fetch(previousMessageId).catch(() => null);
      if (previousMessage) {
        await previousMessage.delete().catch(() => null);
      }
    }
  }

  async function sendMiningEventPing(
    guildId,
    channel,
    definition,
    roleId = null,
    lobbyCount = null,
    { isRepeat = false } = {}
  ) {
    await deletePreviousMiningEventPing(guildId, channel, definition);

    const message = await channel.send({
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createMiningEventPingEmbed(definition, lobbyCount, { isRepeat, appEmojis })],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });

    updateMiningRuntimeState(guildId, (latest) => ({
      pingChannelId: channel.id,
      pingMessageIds: {
        ...latest.pingMessageIds,
        [definition.key]: message.id
      }
    }));
  }

  async function updateTrackedMiningEventPing(guildId, channel, definition, lobbyCount) {
    const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
    const messageId = runtimeState.pingMessageIds[definition.key] || null;
    if (!messageId) {
      return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    const existingEmbed = message?.embeds?.[0];
    if (!message || !existingEmbed) {
      return;
    }

    const embedData = typeof existingEmbed.toJSON === 'function'
      ? existingEmbed.toJSON()
      : existingEmbed;
    const description = createMiningEventPingDescription(definition, lobbyCount, appEmojis);
    if (embedData.description === description) {
      return;
    }

    // Reuse the existing embed data so the original alert timestamp stays put.
    await message.edit({
      embeds: [{ ...embedData, description }]
    }).catch(() => null);
  }

  async function deleteTrackedMiningEventPing(guildId, channel, definitionKey) {
    const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
    const messageId = runtimeState.pingMessageIds[definitionKey] || null;
    if (!messageId) {
      return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.delete().catch(() => null);
    }

    updateMiningRuntimeState(guildId, (latest) => {
      const pingMessageIds = { ...latest.pingMessageIds };
      delete pingMessageIds[definitionKey];
      return { pingMessageIds };
    });
  }

  // Removes the dashboard and every ping from the channel they were posted in, e.g. after
  // the mining channel moved. Running events stay tracked, so they are not pinged again.
  async function deleteTrackedMiningEventMessages(guildId) {
    const tracked = store.getGuildRuntimeState(guildId).miningEvents;
    const messageIds = [tracked.dashboardMessageId, ...Object.values(tracked.pingMessageIds)].filter(Boolean);
    const channel = tracked.pingChannelId && messageIds.length > 0
      ? await client.channels.fetch(tracked.pingChannelId).catch(() => null)
      : null;

    if (channel && channel.isTextBased()) {
      for (const messageId of messageIds) {
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (message) {
          await message.delete().catch(() => null);
        }
      }
    }

    updateMiningRuntimeState(guildId, { dashboardMessageId: null, pingMessageIds: {}, pingChannelId: null });
  }

  // The dashboard is a single message kept in sync with whatever is running, so
  // it lives exactly as long as at least one event does.
  async function syncMiningEventsDashboard(guildId, channel, activeEntries) {
    const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
    const existingId = runtimeState.dashboardMessageId || null;
    const existingMessage = existingId
      ? await channel.messages.fetch(existingId).catch(() => null)
      : null;

    if (activeEntries.length === 0) {
      if (existingMessage) {
        await existingMessage.delete().catch(() => null);
      }
      if (existingId) {
        updateMiningRuntimeState(guildId, { dashboardMessageId: null, pingChannelId: channel.id });
      }
      return;
    }

    const embed = createMiningEventsDashboardEmbed(activeEntries, { appEmojis });

    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed] }).catch(() => null);
      return;
    }

    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    updateMiningRuntimeState(guildId, { dashboardMessageId: message.id, pingChannelId: channel.id });
  }

  async function checkForMiningEvents() {
    let runningEvents;
    try {
      runningEvents = await fetchRunningMiningEvents();
    } catch (error) {
      console.error('Failed to fetch Soopy mining event data:', error);
      return;
    }

    const now = Date.now();

    for (const guildId of store.getMiningEventConfiguredGuildIds()) {
      try {
        const config = store.getGuildConfig(guildId).miningEvents;
        const channel = await client.channels.fetch(config.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const { pingChannelId } = store.getGuildRuntimeState(guildId).miningEvents;
        if (pingChannelId && pingChannelId !== channel.id) {
          await deleteTrackedMiningEventMessages(guildId);
        }

        const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
        const trackedEvents = { ...runtimeState.activeEvents };
        const doublePingStates = { ...runtimeState.doublePingStates };
        let runtimeStateChanged = false;
        const activeEntries = [];

        for (const definition of MINING_EVENT_DEFINITIONS) {
          const runningEntry = findRunningEntry(runningEvents, definition);
          const isDouble = runningEntry?.is_double === true;
          const lastSeenAt = trackedEvents[definition.key] ?? null;
          const storedDoublePing = doublePingStates[definition.key] || null;
          // A pending repeat ping keeps a double event tracked even if the feed dropped it for a while.
          const hasPendingDoublePing = Boolean(
            isDouble &&
            storedDoublePing &&
            !storedDoublePing.handled &&
            now < (storedDoublePing.dueAt + ACTIVE_EVENT_GRACE_MS)
          );
          const isStillTracked = (
            Number.isFinite(lastSeenAt) && now < (lastSeenAt + ACTIVE_EVENT_GRACE_MS)
          ) || hasPendingDoublePing;

          if (!runningEntry && lastSeenAt !== null && !isStillTracked) {
            delete trackedEvents[definition.key];
            delete doublePingStates[definition.key];
            runtimeStateChanged = true;
            await deleteTrackedMiningEventPing(guildId, channel, definition.key);
            continue;
          }

          let normalizedLobbyCount = null;
          if (runningEntry) {
            const lobbyCount = Number(runningEntry.lobby_count);
            normalizedLobbyCount = runningEntry.lobby_count !== null &&
              Number.isInteger(lobbyCount) && lobbyCount >= 0
              ? lobbyCount
              : null;

            activeEntries.push({ definition, lobbyCount: normalizedLobbyCount, isDouble });
            trackedEvents[definition.key] = now;
            runtimeStateChanged = true;

            if (!isStillTracked) {
              await sendMiningEventPing(guildId, channel, definition, config.roles[definition.key], normalizedLobbyCount);
            }
          }

          // A new occurrence starts without a repeat ping; a double one schedules it once.
          let doublePing = isStillTracked || !runningEntry ? storedDoublePing : null;
          if (!doublePing && isDouble) {
            doublePing = { dueAt: now + DOUBLE_EVENT_REPEAT_DELAY_MS, handled: false };
          }

          let sentRepeatPing = false;
          if (doublePing && !doublePing.handled) {
            // Settled once it is sent, once the event is seen running without being double,
            // or once it falls due while the event is missing from the feed.
            const isDue = now >= doublePing.dueAt;
            if (isDouble && isDue && isStillTracked) {
              await sendMiningEventPing(
                guildId,
                channel,
                definition,
                config.roles[definition.key],
                normalizedLobbyCount,
                { isRepeat: true }
              );
              sentRepeatPing = true;
            }

            if (sentRepeatPing || (!isDouble && (runningEntry || isDue))) {
              doublePing = { ...doublePing, handled: true };
            }
          }

          if (doublePing !== storedDoublePing) {
            if (doublePing) {
              doublePingStates[definition.key] = doublePing;
            } else {
              delete doublePingStates[definition.key];
            }
            runtimeStateChanged = true;
          }

          if (runningEntry && isStillTracked && !sentRepeatPing) {
            await updateTrackedMiningEventPing(guildId, channel, definition, normalizedLobbyCount);
          }
        }

        if (runtimeStateChanged) {
          updateMiningRuntimeState(guildId, { activeEvents: trackedEvents, doublePingStates });
        }

        await syncMiningEventsDashboard(guildId, channel, activeEntries);
      } catch (error) {
        console.error(`Mining event check failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendTestMiningEventPing(guildId, definitionKey) {
    const definition = MINING_EVENT_DEFINITION_MAP[definitionKey];
    if (!definition) {
      throw new Error(`Unknown mining event key: ${definitionKey}`);
    }

    const config = store.getGuildConfig(guildId).miningEvents;
    if (!config.channelId) {
      throw new Error(`Guild ${guildId} does not have a configured mining events channel.`);
    }

    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured mining events channel is not a text channel.');
    }

    await sendMiningEventPing(
      guildId,
      channel,
      definition,
      config.roles[definitionKey],
      1
    );
  }

  return {
    checkForMiningEvents,
    deleteTrackedMiningEventMessages,
    sendTestMiningEventPing
  };
}

module.exports = {
  ISLAND_LABELS,
  MINING_EVENT_DEFINITIONS,
  MINING_EVENT_DEFINITION_MAP,
  getMiningEventDefinitionsForIsland,
  createMiningEventPingEmbed,
  createMiningEventsDashboardEmbed,
  createMiningEventsService
};
