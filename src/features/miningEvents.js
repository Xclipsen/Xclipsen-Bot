const { EmbedBuilder } = require('discord.js');

const SOOPY_CHEVENTS_URL = 'https://api.soopy.dev/skyblock/chevents/get';

// An occurrence is tracked by its last sighting in the feed. The grace window
// keeps it alive when the API briefly drops it, which would otherwise look like
// a new start.
const ACTIVE_EVENT_GRACE_MS = 3 * 60 * 1000;
const DOUBLE_EVENT_REPEAT_DELAY_MS = 15 * 60 * 1000;

const ISLAND_LABELS = {
  DWARVEN_MINES: 'Dwarven Mines',
  CRYSTAL_HOLLOWS: 'Crystal Hollows'
};

const ISLAND_KEY_SUFFIXES = {
  DWARVEN_MINES: 'Dwarven',
  CRYSTAL_HOLLOWS: 'Crystal'
};

const ISLAND_EMOJIS = {
  DWARVEN_MINES: '⛏️',
  CRYSTAL_HOLLOWS: '💎'
};

const DASHBOARD_COLOR = 0x9b59b6;

// Runs in both Dwarven Mines and Crystal Hollows.
const SHARED_MINING_EVENTS = [
  { key: 'gwtw', label: 'Gone with the Wind', emoji: '💨', color: 0x3498db, soopyKey: 'GONE_WITH_THE_WIND' },
  { key: 'doublePowder', label: '2x Powder', emoji: '⚡', color: 0x1abc9c, soopyKey: 'DOUBLE_POWDER' },
  { key: 'betterTogether', label: 'Better Together', emoji: '🎭', color: 0xaf7ac5, soopyKey: 'BETTER_TOGETHER' }
];

// Dwarven Mines only.
const DWARVEN_ONLY_MINING_EVENTS = [
  { key: 'goblinRaid', label: 'Goblin Raid', emoji: '⚔️', color: 0xe74c3c, soopyKey: 'GOBLIN_RAID' },
  { key: 'raffle', label: 'Mining Raffle', emoji: '🎟️', color: 0xf1c40f, soopyKey: 'RAFFLE' },
  { key: 'mithrilGourmand', label: 'Mithril Gourmand', emoji: '🍽️', color: 0x16a085, soopyKey: 'MITHRIL_GOURMAND' }
];

function buildRoleAliases(label, islandLabel) {
  const base = label.toLowerCase();
  const variants = [base, `${base} ping`, `${base} role`];

  if (islandLabel) {
    const suffixed = `${base} ${islandLabel.toLowerCase()}`;
    variants.push(suffixed, `${suffixed} ping`, `${suffixed} role`);
  }

  return [...new Set(variants)];
}

const MINING_EVENT_DEFINITIONS = [
  ...SHARED_MINING_EVENTS.flatMap((event) => Object.keys(ISLAND_LABELS).map((island) => {
    const islandLabel = ISLAND_LABELS[island];
    return {
      key: `${event.key}${ISLAND_KEY_SUFFIXES[island]}`,
      label: event.label,
      emoji: event.emoji,
      color: event.color,
      island,
      soopyKey: event.soopyKey,
      roleName: `${event.label} (${islandLabel})`,
      roleAliases: buildRoleAliases(event.label, islandLabel)
    };
  })),
  ...DWARVEN_ONLY_MINING_EVENTS.map((event) => ({
    key: event.key,
    label: event.label,
    emoji: event.emoji,
    color: event.color,
    island: 'DWARVEN_MINES',
    soopyKey: event.soopyKey,
    roleName: event.label,
    roleAliases: buildRoleAliases(event.label, null)
  }))
];

const MINING_EVENT_DEFINITION_MAP = Object.fromEntries(
  MINING_EVENT_DEFINITIONS.map((definition) => [definition.key, definition])
);

function getMiningEventDefinitionsForIsland(island) {
  return MINING_EVENT_DEFINITIONS.filter((definition) => definition.island === island);
}

async function fetchRunningMiningEvents() {
  const response = await fetch(SOOPY_CHEVENTS_URL, { signal: AbortSignal.timeout(10_000) });
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

function createMiningEventPingEmbed(definition, lobbyCount = null, { isRepeat = false } = {}) {
  const lines = [
    `Island: ${ISLAND_LABELS[definition.island]}`,
    `Running in ${formatLobbyCount(lobbyCount)}`
  ];

  return new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(`${definition.emoji} ${definition.label} is ACTIVE${isRepeat ? ' AGAIN' : ''}`)
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

function createMiningEventsDashboardEmbed(activeEntries) {
  const embed = new EmbedBuilder()
    .setColor(DASHBOARD_COLOR)
    .setTitle('⛏️ Active Mining Events')
    .setTimestamp();

  for (const island of Object.keys(ISLAND_LABELS)) {
    const islandEntries = activeEntries.filter((entry) => entry.definition.island === island);
    if (islandEntries.length === 0) {
      continue;
    }

    embed.addFields({
      name: `${ISLAND_EMOJIS[island]} ${ISLAND_LABELS[island]} Events`,
      value: islandEntries
        .map(({ definition, lobbyCount, isDouble }) =>
          `• ${definition.emoji} **${definition.label}** — Running in ${formatLobbyCount(lobbyCount)}${isDouble ? ' · **Double event**' : ''}`)
        .join('\n')
    });
  }

  return embed;
}

function createMiningEventsService({ client, store }) {
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
      embeds: [createMiningEventPingEmbed(definition, lobbyCount, { isRepeat })],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });

    const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      miningEvents: {
        ...runtimeState,
        pingChannelId: channel.id,
        pingMessageIds: {
          ...runtimeState.pingMessageIds,
          [definition.key]: message.id
        }
      }
    });
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

    const nextPingMessageIds = { ...runtimeState.pingMessageIds };
    delete nextPingMessageIds[definitionKey];

    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      miningEvents: {
        ...store.getGuildRuntimeState(guildId).miningEvents,
        pingMessageIds: nextPingMessageIds
      }
    });
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
        await setDashboardMessageId(guildId, null, channel.id);
      }
      return;
    }

    const embed = createMiningEventsDashboardEmbed(activeEntries);

    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed] }).catch(() => null);
      return;
    }

    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await setDashboardMessageId(guildId, message.id, channel.id);
  }

  async function setDashboardMessageId(guildId, messageId, channelId) {
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      miningEvents: {
        ...store.getGuildRuntimeState(guildId).miningEvents,
        dashboardMessageId: messageId,
        pingChannelId: channelId
      }
    });
  }

  // One-off cleanup for pings sent before message-tracking existed. Walks the
  // channel history once per guild and removes any leftover mining event ping,
  // then never scans again (ongoing pings are deleted via pingMessageIds).
  async function sweepOldMiningEventPings(channel) {
    const expectedTitles = new Set(
      MINING_EVENT_DEFINITIONS.flatMap((definition) => [
        `${definition.emoji} ${definition.label} is ACTIVE`,
        `${definition.emoji} ${definition.label} is ACTIVE AGAIN`
      ])
    );

    let before;
    for (let page = 0; page < 10; page += 1) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!batch || batch.size === 0) {
        break;
      }

      const stale = batch.filter((message) =>
        message.author?.id === client.user?.id &&
        message.embeds.some((embed) => expectedTitles.has(embed.title))
      );

      await Promise.all(stale.map((message) => message.delete().catch(() => null)));

      before = batch.last()?.id;
      if (batch.size < 100) {
        break;
      }
    }
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

        if (!store.getGuildRuntimeState(guildId).miningEvents.oldPingsSwept) {
          await sweepOldMiningEventPings(channel);
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            miningEvents: {
              ...store.getGuildRuntimeState(guildId).miningEvents,
              oldPingsSwept: true
            }
          });
        }

        const runtimeState = store.getGuildRuntimeState(guildId).miningEvents;
        const trackedEvents = { ...runtimeState.activeEvents };
        const doublePingStates = { ...runtimeState.doublePingStates };
        let runtimeStateChanged = false;
        const activeEntries = [];

        for (const definition of MINING_EVENT_DEFINITIONS) {
          const runningEntry = findRunningEntry(runningEvents, definition);
          const storedLastSeenAt = trackedEvents[definition.key] ?? null;
          // Older state files stored Soopy's future `ends_at` value here. Capping
          // it at now migrates that state without causing an immediate re-ping.
          const trackedLastSeenAt = Number.isFinite(storedLastSeenAt)
            ? Math.min(storedLastSeenAt, now)
            : null;
          const existingDoublePingState = doublePingStates[definition.key] || null;
          const hasPendingDoublePing = Boolean(
            runningEntry?.is_double === true &&
            existingDoublePingState &&
            !existingDoublePingState.handled &&
            now < (existingDoublePingState.dueAt + ACTIVE_EVENT_GRACE_MS)
          );
          const isStillTracked = (
            Number.isFinite(trackedLastSeenAt) && now < (trackedLastSeenAt + ACTIVE_EVENT_GRACE_MS)
          ) || hasPendingDoublePing;

          if (trackedLastSeenAt !== storedLastSeenAt) {
            trackedEvents[definition.key] = trackedLastSeenAt;
            runtimeStateChanged = true;
          }

          if (!runningEntry) {
            const doublePingState = existingDoublePingState;
            if (doublePingState && !doublePingState.handled && now >= doublePingState.dueAt) {
              doublePingStates[definition.key] = { ...doublePingState, handled: true };
              runtimeStateChanged = true;
            }

            if (trackedLastSeenAt !== null && !isStillTracked) {
              delete trackedEvents[definition.key];
              delete doublePingStates[definition.key];
              runtimeStateChanged = true;
              await deleteTrackedMiningEventPing(guildId, channel, definition.key);
            }
            continue;
          }

          const lobbyCount = Number(runningEntry.lobby_count);
          const normalizedLobbyCount = runningEntry.lobby_count !== null &&
            Number.isInteger(lobbyCount) && lobbyCount >= 0
            ? lobbyCount
            : null;
          const isDouble = runningEntry.is_double === true;

          activeEntries.push({
            definition,
            lobbyCount: normalizedLobbyCount,
            isDouble
          });

          trackedEvents[definition.key] = now;
          runtimeStateChanged = true;

          if (!isStillTracked) {
            delete doublePingStates[definition.key];

            await sendMiningEventPing(
              guildId,
              channel,
              definition,
              config.roles[definition.key],
              normalizedLobbyCount
            );

            if (isDouble) {
              doublePingStates[definition.key] = {
                dueAt: now + DOUBLE_EVENT_REPEAT_DELAY_MS,
                handled: false
              };
            }
            continue;
          }

          let doublePingState = doublePingStates[definition.key] || null;
          if (!doublePingState && isDouble) {
            doublePingState = {
              dueAt: now + DOUBLE_EVENT_REPEAT_DELAY_MS,
              handled: false
            };
            doublePingStates[definition.key] = doublePingState;
            runtimeStateChanged = true;
          }

          if (doublePingState && !doublePingState.handled && !isDouble) {
            doublePingState = { ...doublePingState, handled: true };
            doublePingStates[definition.key] = doublePingState;
            runtimeStateChanged = true;
          }

          if (doublePingState && !doublePingState.handled && now >= doublePingState.dueAt && isDouble) {
            await sendMiningEventPing(
              guildId,
              channel,
              definition,
              config.roles[definition.key],
              normalizedLobbyCount,
              { isRepeat: true }
            );
            doublePingStates[definition.key] = { ...doublePingState, handled: true };
            runtimeStateChanged = true;
          }
        }

        if (runtimeStateChanged) {
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            miningEvents: {
              ...store.getGuildRuntimeState(guildId).miningEvents,
              activeEvents: trackedEvents,
              doublePingStates
            }
          });
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
