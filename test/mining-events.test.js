const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MINING_EVENT_DEFINITION_MAP,
  createMiningEventPingEmbed,
  createMiningEventsDashboardEmbed,
  createMiningEventsService
} = require('../src/features/miningEvents');
const { createStore } = require('../src/storage/store');
const { createFakeAppEmojis, createTempStore } = require('./helpers');

const GUILD_ID = 'guild';
const CHANNEL_ID = 'channel';
const ROLE_ID = 'role';
const EVENT_KEY = 'doublePowderCrystal';

function createMiningEventHarness() {
  let runtimeState = {
    miningEvents: {
      activeEvents: {},
      doublePingStates: {},
      pingMessageIds: {},
      pingChannelId: null,
      dashboardMessageId: null
    }
  };
  let nextMessageId = 1;
  const sentPayloads = [];
  const messages = new Map();

  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    messages: {
      async fetch(messageId) {
        return messages.get(messageId) || null;
      }
    },
    async send(payload) {
      const message = {
        id: String(nextMessageId++),
        payload,
        deleted: false,
        edits: [],
        get embeds() {
          return (this.payload.embeds || []).map((embed) => {
            const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
            return {
              ...data,
              toJSON: () => ({ ...data })
            };
          });
        },
        async delete() {
          this.deleted = true;
          messages.delete(this.id);
        },
        async edit(update) {
          this.edits.push(update);
          this.payload = { ...this.payload, ...update };
          return this;
        }
      };
      sentPayloads.push(payload);
      messages.set(message.id, message);
      return message;
    }
  };

  const store = {
    getMiningEventConfiguredGuildIds: () => [GUILD_ID],
    getGuildConfig: () => ({
      miningEvents: {
        channelId: CHANNEL_ID,
        roles: { [EVENT_KEY]: ROLE_ID }
      }
    }),
    getGuildRuntimeState: () => runtimeState,
    setGuildRuntimeState: (_guildId, nextState) => {
      runtimeState = nextState;
    },
    updateGuildRuntimeSection: (_guildId, section, patch) => {
      const latest = runtimeState[section];
      runtimeState = { ...runtimeState, [section]: { ...latest, ...(typeof patch === 'function' ? patch(latest) : patch) } };
    }
  };

  return {
    channel,
    client: { channels: { fetch: async () => channel } },
    store,
    sentPayloads,
    messages,
    getRuntimeState: () => runtimeState
  };
}

function getRolePingPayloads(sentPayloads) {
  return sentPayloads.filter((payload) => payload.content === `<@&${ROLE_ID}>`);
}

test('mining event embeds show lobby counts without an end time', () => {
  const definition = MINING_EVENT_DEFINITION_MAP[EVENT_KEY];
  const ping = createMiningEventPingEmbed(definition, 38).toJSON();
  const repeat = createMiningEventPingEmbed(definition, 21, { isRepeat: true }).toJSON();
  const dashboard = createMiningEventsDashboardEmbed([{
    definition,
    lobbyCount: 38,
    isDouble: true
  }]).toJSON();

  assert.equal(ping.title, '2x Powder is ACTIVE');
  assert.match(ping.description, /Observed in 38 lobbies so far/);
  assert.equal(repeat.title, '2x Powder is ACTIVE AGAIN');
  assert.match(ping.description, /^Island: 💎 Crystal Hollows$/m);
  assert.equal(ping.thumbnail, undefined);
  assert.match(dashboard.description, /^\*\*💎 Crystal Hollows\*\*\n⚡ \*\*2x Powder\*\* — Observed in 38 lobbies so far/);
  assert.match(dashboard.description, /Double event/);
  assert.doesNotMatch(JSON.stringify({ ping, repeat, dashboard }), /ends|running until/i);
});

test('mining event embeds use application emojis where Discord renders them and keep Unicode titles', () => {
  const appEmojis = createFakeAppEmojis({ mine_double_powder: '11', mine_dwarven_mines: '22', mine_crystal_hollows: '33' });
  const definition = MINING_EVENT_DEFINITION_MAP.doublePowderDwarven;
  const ping = createMiningEventPingEmbed(definition, 3, { appEmojis }).toJSON();
  const dashboard = createMiningEventsDashboardEmbed([
    { definition, lobbyCount: 3, isDouble: false },
    { definition: MINING_EVENT_DEFINITION_MAP.betterTogetherCrystal, lobbyCount: 1, isDouble: false }
  ], { appEmojis }).toJSON();

  assert.equal(ping.title, '2x Powder is ACTIVE', 'titles do not render custom emojis');
  assert.match(ping.description, /^Island: <:mine_dwarven_mines:22> Dwarven Mines$/m);
  assert.equal(ping.thumbnail.url, 'https://cdn.discordapp.com/emojis/11.png');
  assert.equal(dashboard.fields, undefined);
  assert.match(dashboard.description, /\*\*<:mine_dwarven_mines:22> Dwarven Mines\*\*\n<:mine_double_powder:11> \*\*2x Powder\*\*/);
  // Better Together has no item icon and keeps its Unicode emoji.
  assert.match(dashboard.description, /\*\*<:mine_crystal_hollows:33> Crystal Hollows\*\*\n🎭 \*\*Better Together\*\*/);
});

test('a double event sends one persistent repeat ping after 15 minutes', async (t) => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  t.after(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  let now = 1_800_000_000_000;
  let lobbyCount = 2;
  Date.now = () => now;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        data: {
          running_events: {
            CRYSTAL_HOLLOWS: [{
              event: 'DOUBLE_POWDER',
              lobby_count: lobbyCount,
              is_double: true
            }]
          }
        }
      };
    }
  });

  const harness = createMiningEventHarness();
  await createMiningEventsService(harness).checkForMiningEvents();

  const firstState = harness.getRuntimeState().miningEvents.doublePingStates[EVENT_KEY];
  assert.deepEqual(firstState, { dueAt: now + (15 * 60 * 1000), handled: false });
  assert.equal(getRolePingPayloads(harness.sentPayloads).length, 1);

  // Recreating the service simulates a bot restart while retaining store state.
  const restartedService = createMiningEventsService(harness);
  now += 14 * 60 * 1000;
  await restartedService.checkForMiningEvents();
  assert.equal(getRolePingPayloads(harness.sentPayloads).length, 1);

  now += 60 * 1000;
  lobbyCount = 5;
  await restartedService.checkForMiningEvents();

  const rolePings = getRolePingPayloads(harness.sentPayloads);
  assert.equal(rolePings.length, 2);
  assert.equal(rolePings[1].embeds[0].toJSON().title, '2x Powder is ACTIVE AGAIN');
  assert.match(rolePings[1].embeds[0].toJSON().description, /Observed in 5 lobbies so far/);
  assert.equal(harness.getRuntimeState().miningEvents.doublePingStates[EVENT_KEY].handled, true);

  for (let minute = 0; minute < 15; minute += 1) {
    now += 60 * 1000;
    await restartedService.checkForMiningEvents();
  }
  assert.equal(getRolePingPayloads(harness.sentPayloads).length, 2);
});

test('an active event refreshes the tracked ping count without changing its timestamp', async (t) => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  t.after(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  let now = 1_800_000_000_000;
  let lobbyCount = 1;
  Date.now = () => now;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        data: {
          running_events: {
            CRYSTAL_HOLLOWS: [{
              event: 'DOUBLE_POWDER',
              lobby_count: lobbyCount,
              is_double: false
            }]
          }
        }
      };
    }
  });

  const harness = createMiningEventHarness();
  const service = createMiningEventsService(harness);
  await service.checkForMiningEvents();

  const pingMessageId = harness.getRuntimeState().miningEvents.pingMessageIds[EVENT_KEY];
  const pingMessage = harness.messages.get(pingMessageId);
  const originalTimestamp = pingMessage.embeds[0].timestamp;
  assert.match(pingMessage.embeds[0].description, /Observed in 1 lobby so far/);

  now += 60 * 1000;
  lobbyCount = 24;
  await service.checkForMiningEvents();

  assert.equal(pingMessage.edits.length, 1);
  assert.match(pingMessage.embeds[0].description, /Observed in 24 lobbies so far/);
  assert.equal(pingMessage.embeds[0].timestamp, originalTimestamp);

  now += 60 * 1000;
  await service.checkForMiningEvents();
  assert.equal(pingMessage.edits.length, 1);
});

test('a pending repeat ping is cancelled when the event is no longer double', async (t) => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  t.after(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  let now = 1_800_000_000_000;
  let isDouble = true;
  Date.now = () => now;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        data: {
          running_events: {
            CRYSTAL_HOLLOWS: [{
              event: 'DOUBLE_POWDER',
              lobby_count: 2,
              is_double: isDouble
            }]
          }
        }
      };
    }
  });

  const harness = createMiningEventHarness();
  const service = createMiningEventsService(harness);
  await service.checkForMiningEvents();

  isDouble = false;
  for (let minute = 0; minute < 20; minute += 1) {
    now += 60 * 1000;
    await service.checkForMiningEvents();
  }

  assert.equal(getRolePingPayloads(harness.sentPayloads).length, 1);
  assert.equal(harness.getRuntimeState().miningEvents.doublePingStates[EVENT_KEY].handled, true);
});

test('double ping state survives store reloads', (t) => {
  const { paths, store } = createTempStore(t, 'xclipsen-mining-events-');
  store.setGuildRuntimeState(GUILD_ID, {
    miningEvents: {
      activeEvents: { [EVENT_KEY]: 1234 },
      doublePingStates: { [EVENT_KEY]: { dueAt: 5678, handled: false } }
    }
  });

  const reloadedState = createStore(paths).getGuildRuntimeState(GUILD_ID).miningEvents;
  assert.deepEqual(reloadedState.doublePingStates[EVENT_KEY], { dueAt: 5678, handled: false });
});

function createChannel(id) {
  const messages = new Map();
  let nextMessageId = 1;
  return {
    id,
    sent: [],
    isTextBased: () => true,
    messages: {
      fetch: async (messageId) => messages.get(messageId) || null,
      map: messages
    },
    async send(payload) {
      const message = {
        id: `${id}-${nextMessageId++}`,
        payload,
        embeds: (payload.embeds || []).map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed)),
        async delete() { messages.delete(this.id); },
        async edit(update) { this.payload = { ...this.payload, ...update }; return this; }
      };
      messages.set(message.id, message);
      this.sent.push(payload);
      return message;
    }
  };
}

test('moving the mining channel removes the old dashboard and pings without pinging again', async (t) => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  t.after(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  let now = 1_800_000_000_000;
  Date.now = () => now;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, data: { running_events: { CRYSTAL_HOLLOWS: [{ event: 'DOUBLE_POWDER', lobby_count: 3, is_double: false }] } } })
  });

  const { store } = createTempStore(t, 'xclipsen-mining-move-');
  const channels = { old: createChannel('old'), next: createChannel('next') };
  const service = createMiningEventsService({ client: { channels: { fetch: async (id) => channels[id] || null } }, store });

  store.setGuildConfig(GUILD_ID, { miningEvents: { channelId: 'old', roles: { [EVENT_KEY]: ROLE_ID } } });
  await service.checkForMiningEvents();
  assert.equal(channels.old.messages.map.size, 2, 'ping and dashboard');

  // A channel change made elsewhere is cleaned up by the next check.
  store.setGuildConfig(GUILD_ID, { miningEvents: { channelId: 'next', roles: { [EVENT_KEY]: ROLE_ID } } });
  now += 60 * 1000;
  await service.checkForMiningEvents();
  assert.equal(channels.old.messages.map.size, 0);
  assert.equal(channels.next.sent.length, 1, 'only the dashboard; the running event is not pinged again');
  assert.equal(channels.next.sent[0].content, undefined);
  const state = store.getGuildRuntimeState(GUILD_ID).miningEvents;
  assert.equal(state.pingChannelId, 'next');
  assert.deepEqual(state.pingMessageIds, {});
  assert.ok(state.dashboardMessageId.startsWith('next-'));

  // The setup editor removes the posts right away when the channel moves.
  await service.deleteTrackedMiningEventMessages(GUILD_ID);
  assert.equal(channels.next.messages.map.size, 0);
  assert.equal(store.getGuildRuntimeState(GUILD_ID).miningEvents.dashboardMessageId, null);
});

test('the setup editor clears tracked mining posts before moving the channel', async () => {
  const { SECTIONS } = require('../src/features/setupHub/editor');
  const calls = [];
  const deps = {
    store: { getGuildConfig: () => ({ miningEvents: { channelId: 'old', roles: {} } }), setGuildConfig: (_, patch) => calls.push(['config', patch.miningEvents.channelId]) },
    setupHub: { deleteMiningRolePanels: async () => calls.push(['panels']) },
    miningEvents: { deleteTrackedMiningEventMessages: async (guildId) => calls.push(['posts', guildId]) }
  };

  await SECTIONS.mining.moveChannel(deps, { id: GUILD_ID }, 'next');
  assert.deepEqual(calls, [['posts', GUILD_ID], ['panels'], ['config', 'next']]);
});
