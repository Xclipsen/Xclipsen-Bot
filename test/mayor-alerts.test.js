process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Collection } = require('discord.js');

const { env } = require('../src/config/env');
const { createMayorAlerts } = require('../src/features/mayorAlerts');
const { createEventRemindersService } = require('../src/features/eventReminders');
const { createSkyblockUtils } = require('../src/utils/skyblock');
const { createTempStore } = require('./helpers');

const GUILD = '1257088955711619163';
const CHANNEL = '345678901234567890';
const MAYOR_ROLE = '234567890123456789';
const EVENT_ROLE = '234567890123456780';
const PAUL = { key: 'paul', name: 'Paul', perks: [{ name: 'EZPZ', description: 'Gain 10 bonus score.' }] };

function electionData(boothOpen) {
  return {
    success: true,
    mayor: PAUL,
    current: { candidates: [{ key: 'paul', name: 'Paul', votes: 10, perks: PAUL.perks }] },
    _mock: { boothOpen }
  };
}

function createHarness(t, { guildEmojis = null } = {}) {
  const { store } = createTempStore(t, 'mayor-alerts-');
  store.setGuildConfig(GUILD, { channelId: CHANNEL, roleId: MAYOR_ROLE, eventReminders: { channelId: CHANNEL, roles: { darkAuction: EVENT_ROLE } } });

  let nextId = 900000000000000000n;
  const messages = new Collection();
  const sent = [];
  const channel = {
    id: CHANNEL,
    isTextBased: () => true,
    messages: {
      async fetch(key) {
        if (typeof key === 'object') {
          return messages;
        }
        const message = messages.get(key);
        if (!message) {
          throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        }
        return message;
      }
    },
    async send(payload) {
      nextId += 1n;
      const id = String(nextId);
      const message = {
        id,
        channelId: CHANNEL,
        author: { id: 'bot' },
        content: payload.content || null,
        embeds: (payload.embeds || []).map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed)),
        createdTimestamp: Number(nextId),
        async delete() { messages.delete(id); },
        async edit(update) { message.embeds = (update.embeds || []).map((embed) => embed.toJSON()); return message; }
      };
      messages.set(id, message);
      sent.push(message);
      return message;
    }
  };
  if (guildEmojis) {
    channel.guild = { emojis: { fetch: async () => guildEmojis, cache: guildEmojis } };
  }

  const client = { user: { id: 'bot' }, guilds: { cache: new Map([[GUILD, {}]]) }, channels: { fetch: async () => channel } };
  const mayorAlerts = createMayorAlerts({ client, env, store, skyblock: createSkyblockUtils() });
  const setElection = (data) => store.setMockState({ enabled: true, customData: data });
  return { store, channel, messages, sent, mayorAlerts, setElection };
}

const isBoothPing = (message) => message.content?.includes('Election Booth Open');

test('the booth-open ping is sent even when a status update ran first', async (t) => {
  const h = createHarness(t);
  h.setElection(electionData(false));
  await h.mayorAlerts.checkElectionState();
  assert.equal(h.store.getGuildRuntimeState(GUILD).boothOpen, false);

  // The 30-minute status update and a status refresh land between two 5-minute checks.
  h.setElection(electionData(true));
  await h.mayorAlerts.sendScheduledStatusUpdate();
  await h.mayorAlerts.refreshStatusForGuild(GUILD);
  assert.equal(h.store.getGuildRuntimeState(GUILD).boothOpen, false, 'only the election check records the booth state');
  assert.equal(h.sent.some(isBoothPing), false);

  await h.mayorAlerts.checkElectionState();
  const pings = h.sent.filter(isBoothPing);
  assert.equal(pings.length, 1);
  assert.equal(pings[0].content, `<@&${MAYOR_ROLE}>\n:ballot_box: **Election Booth Open**`);
  assert.equal(h.store.getGuildRuntimeState(GUILD).boothOpen, true);

  await h.mayorAlerts.checkElectionState();
  assert.equal(h.sent.filter(isBoothPing).length, 1);
});

test('a guild configured since the last check learns the booth state without a ping', async (t) => {
  const h = createHarness(t);
  h.setElection(electionData(true));
  await h.mayorAlerts.checkElectionState();
  h.store.setGuildRuntimeState(GUILD, { boothOpen: null });

  await h.mayorAlerts.checkElectionState();
  assert.equal(h.store.getGuildRuntimeState(GUILD).boothOpen, true);
  assert.equal(h.sent.some(isBoothPing), false);
});

test('clearing the mayor posts keeps event reminder pings in the shared channel', async (t) => {
  const h = createHarness(t);
  const eventPing = await h.channel.send({ content: `<@&${EVENT_ROLE}>\n💵 Dark Auction is active now.`, embeds: [{ title: '💵 Dark Auction is ACTIVE' }] });
  const oldMayorPing = await h.channel.send({ content: `<@&${MAYOR_ROLE}>\n🗝️ A new mayor has been elected.` });
  h.setElection(electionData(true));
  await h.mayorAlerts.checkElectionState();
  h.store.setGuildRuntimeState(GUILD, { boothOpen: false });
  await h.mayorAlerts.checkElectionState();
  const trackedPing = h.sent.find(isBoothPing);
  assert.ok(trackedPing);
  assert.ok(h.store.getGuildRuntimeState(GUILD).statusMessageId);

  await h.mayorAlerts.deleteTrackedMessagesForGuild(GUILD);

  assert.deepEqual([...h.messages.keys()], [eventPing.id]);
  assert.equal(h.messages.has(oldMayorPing.id), false);
  const state = h.store.getGuildRuntimeState(GUILD);
  assert.equal(state.alertMessageId, null);
  assert.equal(state.statusMessageId, null);
});

test('a status refresh with election data passed in does not request the API again', async (t) => {
  const h = createHarness(t);
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => { fetches += 1; throw new Error('no network in tests'); };
  t.after(() => { global.fetch = originalFetch; });

  await h.mayorAlerts.refreshStatusForGuild(GUILD, electionData(false));
  assert.equal(fetches, 0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].embeds[1].fields.find((field) => field.name === 'Mayor').value, 'Paul (paul)');
});

test('event reminders hand their election data to the status refresh', async () => {
  const data = electionData(false);
  const refreshed = [];
  let state = { eventReminders: { lastSentStarts: {}, messageIds: {}, messageExpireAts: {}, feastRotations: {} } };
  const channel = {
    id: CHANNEL,
    isTextBased: () => true,
    messages: { fetch: async (key) => (typeof key === 'object' ? new Collection() : null) },
    send: async () => ({ id: '1', channelId: CHANNEL })
  };
  const service = createEventRemindersService({
    client: { user: { id: 'bot' }, channels: { fetch: async () => channel } },
    store: {
      getEventReminderConfiguredGuildIds: () => [GUILD],
      getGuildConfig: () => ({ eventReminders: { channelId: CHANNEL, roles: {} } }),
      getGuildRuntimeState: () => state,
      updateGuildRuntimeSection: (_, section, patch) => {
        state = { ...state, [section]: { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) } };
      }
    },
    mayorAlerts: {
      getCachedElectionData: () => data,
      getCachedElectionDataFetchedAt: () => 1,
      fetchElectionData: async () => { throw new Error('must use the cached data'); },
      refreshStatusForGuild: async (guildId, electionDataArgument) => refreshed.push([guildId, electionDataArgument])
    },
    nowFn: () => 1_800_000_000_000,
    scheduleProvider: () => ({ darkAuction: { key: 'darkAuction', isActive: true, windowStartAt: 1_800_000_000_000, windowEndAt: 1_800_000_060_000 } })
  });

  await service.checkForReminders();
  assert.deepEqual(refreshed, [[GUILD, data]]);
});

test('a missing mayor emoji is reported once, not on every status update', async (t) => {
  const h = createHarness(t, { guildEmojis: new Collection() });
  const logged = [];
  t.mock.method(console, 'log', (...args) => logged.push(args.join(' ')));
  h.setElection({ ...electionData(false), mayor: { key: 'nobody', name: 'Nobody', perks: [] } });

  await h.mayorAlerts.sendScheduledStatusUpdate();
  await h.mayorAlerts.sendScheduledStatusUpdate();
  await h.mayorAlerts.refreshStatusForGuild(GUILD);

  assert.equal(logged.filter((line) => line.startsWith('No custom emoji found')).length, 1);
});
