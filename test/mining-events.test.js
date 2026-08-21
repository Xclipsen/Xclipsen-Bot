const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MINING_EVENT_DEFINITION_MAP,
  createMiningEventPingEmbed,
  createMiningEventsDashboardEmbed,
  createMiningEventsService
} = require('../src/features/miningEvents');
const { createStore } = require('../src/storage/store');

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
      dashboardMessageId: null,
      oldPingsSwept: true
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
        async delete() {
          this.deleted = true;
          messages.delete(this.id);
        },
        async edit(update) {
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
    }
  };

  return {
    channel,
    client: { channels: { fetch: async () => channel } },
    store,
    sentPayloads,
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

  assert.equal(ping.title, '⚡ 2x Powder is ACTIVE');
  assert.match(ping.description, /Running in 38 lobbies/);
  assert.equal(repeat.title, '⚡ 2x Powder is ACTIVE AGAIN');
  assert.match(dashboard.fields[0].value, /Running in 38 lobbies/);
  assert.match(dashboard.fields[0].value, /Double event/);
  assert.doesNotMatch(JSON.stringify({ ping, repeat, dashboard }), /ends|running until/i);
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
  assert.equal(rolePings[1].embeds[0].toJSON().title, '⚡ 2x Powder is ACTIVE AGAIN');
  assert.match(rolePings[1].embeds[0].toJSON().description, /Running in 5 lobbies/);
  assert.equal(harness.getRuntimeState().miningEvents.doublePingStates[EVENT_KEY].handled, true);

  for (let minute = 0; minute < 15; minute += 1) {
    now += 60 * 1000;
    await restartedService.checkForMiningEvents();
  }
  assert.equal(getRolePingPayloads(harness.sentPayloads).length, 2);
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
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xclipsen-mining-events-'));
  t.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

  const paths = {
    configFilePath: path.join(tempDirectory, 'config.json'),
    shitterFilePath: path.join(tempDirectory, 'shitter.json'),
    stateFilePath: path.join(tempDirectory, 'state.json')
  };
  const store = createStore(paths);
  store.setGuildRuntimeState(GUILD_ID, {
    miningEvents: {
      activeEvents: { [EVENT_KEY]: 1234 },
      doublePingStates: { [EVENT_KEY]: { dueAt: 5678, handled: false } }
    }
  });

  const reloadedState = createStore(paths).getGuildRuntimeState(GUILD_ID).miningEvents;
  assert.deepEqual(reloadedState.doublePingStates[EVENT_KEY], { dueAt: 5678, handled: false });
});
