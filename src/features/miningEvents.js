const { EmbedBuilder } = require('discord.js');

const SOOPY_CHEVENTS_URL = 'https://api.soopy.dev/skyblock/chevents/get';

// Soopy keeps refining `ends_at` between polls, so an occurrence is tracked by
// its rising edge instead. The grace window keeps a tracked occurrence alive
// when the API briefly drops it, which would otherwise look like a new start.
const ACTIVE_EVENT_GRACE_MS = 3 * 60 * 1000;

const ISLAND_LABELS = {
  DWARVEN_MINES: 'Dwarven Mines',
  CRYSTAL_HOLLOWS: 'Crystal Hollows'
};

const ISLAND_KEY_SUFFIXES = {
  DWARVEN_MINES: 'Dwarven',
  CRYSTAL_HOLLOWS: 'Crystal'
};

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

function createMiningEventPingEmbed(definition, endsAt) {
  const endsAtSeconds = Math.floor(endsAt / 1000);

  return new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(`${definition.emoji} ${definition.label} is ACTIVE`)
    .setDescription([
      `Island: ${ISLAND_LABELS[definition.island]}`,
      `Ends: <t:${endsAtSeconds}:R> (<t:${endsAtSeconds}:F>)`
    ].join('\n'))
    .setTimestamp();
}

function createMiningEventsService({ client, store }) {
  async function sendMiningEventPing(channel, definition, endsAt, roleId = null) {
    await channel.send({
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createMiningEventPingEmbed(definition, endsAt)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
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

        const trackedEvents = { ...store.getGuildRuntimeState(guildId).miningEvents.activeEvents };
        let trackedEventsChanged = false;

        for (const definition of MINING_EVENT_DEFINITIONS) {
          const runningEntry = findRunningEntry(runningEvents, definition);
          const trackedEndsAt = trackedEvents[definition.key] ?? null;
          const isStillTracked = Number.isFinite(trackedEndsAt) && now < (trackedEndsAt + ACTIVE_EVENT_GRACE_MS);

          if (!runningEntry) {
            if (trackedEndsAt !== null && !isStillTracked) {
              delete trackedEvents[definition.key];
              trackedEventsChanged = true;
            }
            continue;
          }

          const endsAt = Number(runningEntry.ends_at);
          if (!Number.isFinite(endsAt)) {
            continue;
          }

          // Keep the refined end time so the grace window tracks the latest estimate.
          trackedEvents[definition.key] = endsAt;
          trackedEventsChanged = true;

          if (isStillTracked) {
            continue;
          }

          await sendMiningEventPing(channel, definition, endsAt, config.roles[definition.key]);
        }

        if (trackedEventsChanged) {
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            miningEvents: {
              ...store.getGuildRuntimeState(guildId).miningEvents,
              activeEvents: trackedEvents
            }
          });
        }
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

    await sendMiningEventPing(channel, definition, Date.now() + (10 * 60 * 1000), config.roles[definitionKey]);
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
  createMiningEventsService
};
