process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Collection } = require('discord.js');

const { env } = require('../src/config/env');
const { createSkyblockUtils } = require('../src/utils/skyblock');
const {
  SLOTS_PER_TERM,
  WIKI_PAGE_BASE_URL,
  createJerryRotation,
  formatPerkpocalypseField,
  getTermAt,
  getTermStartAt,
  parsePerkpocalypseWikitext,
  resolvePerkpocalypseState
} = require('../src/features/jerryRotation');
const {
  EVENT_DEFINITIONS,
  EVENT_DEFINITION_MAP,
  formatCalendarEntry,
  getCalendarEntries,
  getReminderStatusLine
} = require('../src/features/eventCalendar');
const { createEventRemindersService } = require('../src/features/eventReminders');
const { createMayorAlertEmbeds } = require('../src/features/mayorAlerts/embeds');
const { createStore, normalizeGuildConfig } = require('../src/storage/store');
const { createFakeAppEmojis } = require('./helpers');

const ORDER_521 = ['Cole', 'Aatrox', 'Paul', 'Diana', 'Finnegan', 'Marina'];
const PAGE_521 = `{{Perkpocalypse
| year   = 521
| mayor1 = Cole
| mayor2 = Aatrox
| mayor3 = Paul
| mayor4 = Diana
| mayor5 = Finnegan
| mayor6 = Marina
}}

<noinclude>[[Category:Transclusion templates]]</noinclude>`;
const TERM_521_START = Date.UTC(2026, 9, 20, 15, 15);
const HOUR = 60 * 60 * 1000;
const JERRY = {
  key: 'jerry',
  name: 'Jerry',
  perks: [{ name: 'Perkpocalypse', description: 'Activates all perks of another mayor every 18 SkyBlock days (6 hours).' }],
  election: { year: 520 }
};
const PAUL = { key: 'paul', name: 'Paul', perks: [{ name: 'EZPZ', description: 'Gain 10 bonus score.' }], election: { year: 520 } };
const at = (iso) => Date.parse(iso);
const seconds = (timestamp) => Math.floor(timestamp / 1000);

function page521(extraParams = '') {
  return PAGE_521.replace('}}\n', `${extraParams}}}\n`);
}

function createClock(iso) {
  let value = at(iso);
  return {
    now: () => value,
    set: (nextIso) => { value = at(nextIso); },
    advance: (ms) => { value += ms; }
  };
}

function createFakeFetch(handler = () => ({ status: 200, body: PAGE_521 })) {
  const calls = [];
  async function fakeFetch(url, options) {
    calls.push({ url, options });
    const result = await handler(url, options, calls.length);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => result.body
    };
  }
  return { fetch: fakeFetch, calls };
}

function createLogger() {
  const warnings = [];
  return { warnings, logger: { log() {}, warn: (message) => warnings.push(String(message)) } };
}

async function createLoadedRotation(iso, page = PAGE_521) {
  const clock = createClock(iso);
  const fake = createFakeFetch(() => ({ status: 200, body: page }));
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });
  await rotation.refresh({ mayor: JERRY });
  return { rotation, clock, fake };
}

test('parser reads the Year 521 wiki page in numeric order', () => {
  assert.deepEqual(parsePerkpocalypseWikitext(PAGE_521, 521), { year: 521, mayors: ORDER_521, skipped: [], strike: [] });
});

test('parser handles strike ranges, skipped rows, candidate, prefixes and partial orders', () => {
  const parsed = parsePerkpocalypseWikitext(`<!-- order revealed during the term -->
{{Perkpocalypse
|year = 257
|candidate = Jerry
|mayor6 = Diana
|mayor1 = Mayor cole
|mayor2 = Candidate PAUL
|mayor3 = -
|mayor4 =
|strike = 3, 7-9
}}`);

  assert.deepEqual(parsed, {
    year: 257,
    mayors: ['Cole', 'Paul', null, null, null, 'Diana'],
    skipped: [3],
    strike: [3, 7, 8, 9]
  });
});

test('parser uses the first (main server) table and ignores later ones', () => {
  const parsed = parsePerkpocalypseWikitext(`=== Main Server Timetable ===
{{perkpocalypse|year=233|mayor1=[[Diana]]|mayor2=Aatrox}}
=== Alpha Network Timetable ===
{{Perkpocalypse|year=233|mayor1=Paul|mayor2=Cole}}`, 233);

  assert.deepEqual(parsed.mayors, ['Diana', 'Aatrox']);
});

test('parser rejects garbage, invalid parameters and pages for another year', () => {
  for (const text of [
    null,
    '',
    'Just some text without a template',
    '{{Perkpocalypse|year=abc|mayor1=Cole}}',
    '{{Perkpocalypse|year=521}}',
    '{{Perkpocalypse|year=521|mayor1=Cole|strike=3,,4}}',
    '{{Perkpocalypse|year=521|mayor1=Cole|strike=5-3}}',
    '{{Perkpocalypse|year=521|mayor1=Cole|strike=0}}',
    '{{Perkpocalypse|year=521|mayor1=Cole',
    '{{Perkpocalypse|year=521|mayor99=Cole}}'
  ]) {
    assert.equal(parsePerkpocalypseWikitext(text, 521), null, String(text));
  }

  assert.equal(parsePerkpocalypseWikitext(PAGE_521, 497), null);
  assert.deepEqual(parsePerkpocalypseWikitext('{{Perkpocalypse|year=521|mayor1={{Unknown}}|mayor2=Paul}}', 521).mayors, [null, 'Paul']);
});

test('Year 521 term starts at Late Spring 27', () => {
  const term = getTermAt(at('2026-10-21T15:00:00Z'));

  assert.equal(getTermStartAt(521), 1792509300000);
  assert.equal(getTermStartAt(521), TERM_521_START);
  assert.equal(term.year, 521);
  assert.equal(term.termEndAt - term.termStartAt, 124 * HOUR);
  assert.equal(SLOTS_PER_TERM, 21);
});

test('Year 521 slots match the wiki timetable', () => {
  const rotation = parsePerkpocalypseWikitext(PAGE_521, 521);
  const expected = [
    ['2026-10-20T15:15:00Z', '2026-10-20T21:15:00Z', 'Cole'],
    ['2026-10-20T21:15:00Z', '2026-10-21T03:15:00Z', 'Aatrox'],
    ['2026-10-21T03:15:00Z', '2026-10-21T09:15:00Z', 'Paul'],
    ['2026-10-21T09:15:00Z', '2026-10-21T15:15:00Z', 'Diana'],
    ['2026-10-21T15:15:00Z', '2026-10-21T21:15:00Z', 'Finnegan'],
    ['2026-10-21T21:15:00Z', '2026-10-22T03:15:00Z', 'Marina'],
    ['2026-10-22T03:15:00Z', '2026-10-22T09:15:00Z', 'Cole'],
    ['2026-10-25T15:15:00Z', '2026-10-25T19:15:00Z', 'Paul']
  ];

  for (const [startIso, endIso, mayor] of expected) {
    const state = resolvePerkpocalypseState(at(startIso) + 1000, JERRY, rotation);
    assert.equal(state.current.mayor, mayor, startIso);
    assert.equal(state.current.startAt, at(startIso), startIso);
    assert.equal(state.current.endAt, at(endIso), startIso);
  }

  for (let index = 0; index < SLOTS_PER_TERM; index += 1) {
    const state = resolvePerkpocalypseState(TERM_521_START + (index * 6 * HOUR), JERRY, rotation);
    assert.equal(state.current.slot, index + 1);
    assert.equal(state.current.mayor, ORDER_521[index % ORDER_521.length]);
  }
});

test('current slot, upcoming slots and term edges', () => {
  const rotation = parsePerkpocalypseWikitext(PAGE_521, 521);

  const diana = resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), JERRY, rotation);
  assert.equal(diana.year, 521);
  assert.equal(diana.termStartAt, TERM_521_START);
  assert.equal(diana.slotMs, 6 * HOUR);
  assert.deepEqual(diana.order, ORDER_521);
  assert.deepEqual(diana.current, { mayor: 'Diana', startAt: at('2026-10-21T09:15:00Z'), endAt: at('2026-10-21T15:15:00Z'), slot: 4, struck: false });

  const finnegan = resolvePerkpocalypseState(at('2026-10-21T15:20:00Z'), JERRY, rotation);
  assert.equal(finnegan.current.mayor, 'Finnegan');
  assert.equal(finnegan.current.endAt, at('2026-10-21T21:15:00Z'));
  assert.deepEqual(finnegan.upcoming.map((slot) => slot.mayor), ['Marina', 'Cole', 'Aatrox', 'Paul', 'Diana']);
  assert.equal(finnegan.upcoming[0].startAt, at('2026-10-21T21:15:00Z'));

  const last = resolvePerkpocalypseState(at('2026-10-25T18:00:00Z'), JERRY, rotation);
  assert.equal(last.current.mayor, 'Paul');
  assert.equal(last.current.slot, 21);
  assert.equal(last.current.endAt, at('2026-10-25T19:15:00Z'));
  assert.equal(last.termEndAt, at('2026-10-25T19:15:00Z'));
  assert.deepEqual(last.upcoming, []);

  assert.equal(resolvePerkpocalypseState(at('2026-10-25T10:00:00Z'), JERRY, rotation).upcoming.length, 1);

  // Election data still showing Jerry outside his term is stale.
  assert.equal(resolvePerkpocalypseState(at('2026-10-20T15:00:00Z'), JERRY, rotation), null);
  assert.equal(resolvePerkpocalypseState(at('2026-10-25T19:15:00Z'), JERRY, rotation), null);
  assert.equal(resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), JERRY, rotation, { mayorFetchedAt: at('2026-10-20T15:00:00Z') }), null);

  // Without an election year (simulation data) the term comes from time alone; the 521 order does not apply to 522.
  const simulated = resolvePerkpocalypseState(at('2026-10-25T19:15:00Z'), { key: 'jerry', name: 'Jerry' }, rotation);
  assert.equal(simulated.year, 522);
  assert.equal(simulated.order, null);
  assert.equal(simulated.current.mayor, null);
});

test('state is null for other mayors and keeps slot times when the order is unknown', () => {
  assert.equal(resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), PAUL, null), null);
  assert.equal(resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), null, null), null);

  const unknown = resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), JERRY, null);
  assert.equal(unknown.order, null);
  assert.equal(unknown.current.mayor, null);
  assert.equal(unknown.current.endAt, at('2026-10-21T15:15:00Z'));
  assert.equal(unknown.upcoming.length, 5);
});

test('struck slots and skipped rows are marked', () => {
  const rotation = parsePerkpocalypseWikitext(page521('| strike = 5\n'), 521);
  const struck = resolvePerkpocalypseState(at('2026-10-21T15:20:00Z'), JERRY, rotation);
  assert.equal(struck.current.mayor, 'Finnegan');
  assert.equal(struck.current.struck, true);
  assert.equal(struck.upcoming[0].struck, false);

  const skipped = parsePerkpocalypseWikitext(PAGE_521.replace('mayor3 = Paul', 'mayor3 = -'), 521);
  const paulSlot = resolvePerkpocalypseState(at('2026-10-21T04:00:00Z'), JERRY, skipped);
  assert.equal(paulSlot.current.mayor, null);
  assert.equal(paulSlot.current.struck, true);
});

test('refresh fetches the wiki once and reuses the cached order', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const fake = createFakeFetch();
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });

  await rotation.refresh({ mayor: JERRY });
  await rotation.refresh({ mayor: JERRY });
  clock.advance(HOUR);
  await rotation.refresh({ mayor: JERRY });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, `${WIKI_PAGE_BASE_URL}521?action=raw`);
  assert.match(fake.calls[0].options.headers['User-Agent'], /hypixel-mayor-discord-bot/);
  assert.ok(fake.calls[0].options.signal);
  assert.deepEqual(rotation.getPerkpocalypseState(clock.now(), JERRY).order, ORDER_521);

  clock.advance(5 * HOUR);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 2);
});

test('refresh shares one request between concurrent callers', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  let release;
  const fake = createFakeFetch(() => new Promise((resolve) => { release = () => resolve({ status: 200, body: PAGE_521 }); }));
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });

  const first = rotation.refresh({ mayor: JERRY });
  const second = rotation.refresh({ mayor: JERRY });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(rotation.getRotation(521).mayors, ORDER_521);
});

test('refresh backs off after failures, logs once per problem and never throws', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const { warnings, logger } = createLogger();
  let mode = 'missing';
  const fake = createFakeFetch(() => {
    if (mode === 'network') throw new Error('getaddrinfo ENOTFOUND');
    if (mode === 'garbage') return { status: 200, body: '<html>maintenance</html>' };
    if (mode === 'missing') return { status: 404, body: '' };
    return { status: 200, body: PAGE_521 };
  });
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger });

  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 1);
  assert.equal(rotation.getPerkpocalypseState(clock.now(), JERRY).order, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Year 521.*404/);

  clock.advance(5 * 60 * 1000);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 1);

  clock.advance(10 * 60 * 1000);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 2);
  assert.equal(warnings.length, 1);

  mode = 'network';
  clock.advance(15 * 60 * 1000);
  await assert.doesNotReject(rotation.refresh({ mayor: JERRY }));
  mode = 'garbage';
  clock.advance(15 * 60 * 1000);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 4);
  assert.equal(warnings.length, 3);

  mode = 'ok';
  clock.advance(15 * 60 * 1000);
  await rotation.refresh({ mayor: JERRY });
  assert.deepEqual(rotation.getPerkpocalypseState(clock.now(), JERRY).order, ORDER_521);

  // A later failure keeps the known order.
  mode = 'network';
  clock.advance(7 * HOUR);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 6);
  assert.deepEqual(rotation.getPerkpocalypseState(clock.now(), JERRY).order, ORDER_521);
});

test('refresh skips other mayors, missing data and stale election years', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const fake = createFakeFetch();
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });

  await rotation.refresh({ mayor: PAUL });
  await rotation.refresh(null);
  await rotation.refresh({ mayor: { ...JERRY, election: { year: 496 } } });
  assert.equal(fake.calls.length, 0);
});

test('partially published orders are checked again after 15 minutes', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const partial = PAGE_521.replace('mayor5 = Finnegan', 'mayor5 =').replace('mayor6 = Marina', 'mayor6 =');
  let body = partial;
  const fake = createFakeFetch(() => ({ status: 200, body }));
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });

  await rotation.refresh({ mayor: JERRY });
  assert.equal(rotation.getPerkpocalypseState(at('2026-10-21T15:20:00Z'), JERRY).current.mayor, null);

  body = PAGE_521;
  clock.advance(15 * 60 * 1000);
  await rotation.refresh({ mayor: JERRY });
  assert.equal(fake.calls.length, 2);
  assert.equal(rotation.getPerkpocalypseState(at('2026-10-21T15:20:00Z'), JERRY).current.mayor, 'Finnegan');
});

test('the order is persisted in the store and survives a restart without wiki access', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jerry-rotation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = {
    configFilePath: path.join(directory, 'config.json'),
    shitterFilePath: path.join(directory, 'shitter.json'),
    stateFilePath: path.join(directory, 'state.json')
  };
  const clock = createClock('2026-10-21T15:00:00Z');

  const first = createJerryRotation({ fetch: createFakeFetch().fetch, now: clock.now, store: createStore(files), logger: createLogger().logger });
  await first.refresh({ mayor: JERRY });

  const reloadedStore = createStore(files);
  assert.equal(reloadedStore.getJerryRotationCache().year, 521);
  assert.deepEqual(reloadedStore.getJerryRotationCache().mayors, ORDER_521);

  const offline = createFakeFetch(() => { throw new Error('offline'); });
  const restarted = createJerryRotation({ fetch: offline.fetch, now: clock.now, store: reloadedStore, logger: createLogger().logger });
  assert.equal(restarted.getPerkpocalypseState(clock.now(), JERRY).current.mayor, 'Diana');
  await restarted.refresh({ mayor: JERRY });
  assert.equal(offline.calls.length, 0);

  clock.advance(7 * HOUR);
  await restarted.refresh({ mayor: JERRY });
  assert.equal(offline.calls.length, 1);
  assert.deepEqual(restarted.getPerkpocalypseState(clock.now(), JERRY).order, ORDER_521);
});

test('adding the event keeps existing role config and adds an empty Jerry slot', () => {
  const config = normalizeGuildConfig({ eventReminders: { channelId: '1', roles: { darkAuction: '2' } } });
  assert.equal(config.eventReminders.roles.darkAuction, '2');
  assert.equal(config.eventReminders.roles.jerryPerkpocalypse, null);
  assert.equal(new Set(EVENT_DEFINITIONS.map((definition) => definition.emoji)).size, EVENT_DEFINITIONS.length);
});

test('event schedule is inactive and hidden while Jerry is not mayor', () => {
  const definition = EVENT_DEFINITION_MAP.jerryPerkpocalypse;
  const schedule = definition.getSchedule(at('2026-10-21T15:00:00Z'), { mayor: PAUL });

  assert.equal(schedule.isActive, false);
  assert.equal(schedule.windowStartAt, null);
  assert.equal(schedule.windowEndAt, null);
  assert.match(schedule.reason, /Jerry is mayor/);
  assert.deepEqual(definition.extraLines(schedule), [schedule.reason]);
  assert.equal(getCalendarEntries(at('2026-10-21T15:00:00Z'), { mayor: PAUL }).some((entry) => entry.key === 'jerryPerkpocalypse'), false);
});

test('event schedule opens a new window for each rotation slot and names the mayor', async () => {
  const { rotation } = await createLoadedRotation('2026-10-21T15:00:00Z');
  const definition = EVENT_DEFINITION_MAP.jerryPerkpocalypse;
  const context = { mayor: JERRY, mayorFetchedAt: at('2026-10-21T14:58:00Z'), jerryRotation: rotation };

  const diana = definition.getSchedule(at('2026-10-21T15:00:00Z'), context);
  assert.equal(diana.isActive, true);
  assert.equal(diana.windowStartAt, at('2026-10-21T09:15:00Z'));
  assert.equal(diana.windowEndAt, at('2026-10-21T15:15:00Z'));
  assert.equal(diana.reminderDeleteAt, at('2026-10-21T15:15:00Z'));
  assert.deepEqual(definition.extraLines(diana), [
    "Now: **Diana** (Huntress' Intuition, Mythological Ritual, Pet XP Buff, Sharing is Caring)",
    `Next: Finnegan <t:${seconds(at('2026-10-21T15:15:00Z'))}:t>`
  ]);
  assert.equal(getReminderStatusLine(definition, diana), "🔄 Diana's perks are active now (Jerry's Perkpocalypse).");

  const finnegan = definition.getSchedule(at('2026-10-21T15:20:00Z'), context);
  assert.equal(finnegan.isActive, true);
  assert.notEqual(finnegan.windowStartAt, diana.windowStartAt);
  assert.equal(finnegan.windowStartAt, at('2026-10-21T15:15:00Z'));
  assert.match(definition.extraLines(finnegan)[0], /\*\*Finnegan\*\*/);
  assert.match(definition.reminderFields(finnegan)[0].value, /Grand Feast is not activated by Jerry/);

  const entry = getCalendarEntries(at('2026-10-21T15:00:00Z'), { mayor: JERRY, jerryRotation: rotation })
    .find((calendarEntry) => calendarEntry.key === 'jerryPerkpocalypse');
  assert.ok(entry);
  assert.match(formatCalendarEntry(entry), /Now: \*\*Diana\*\*/);
  assert.match(formatCalendarEntry(entry), /^🔄 \*\*Jerry's Perkpocalypse\*\* · \*\*now\*\* · ends <t:\d+:R>\n<t:\d+:f> – <t:\d+:t> · 6 hours\n/);
});

test('event schedule skips struck slots and falls back to slot times without an order', async () => {
  const { rotation } = await createLoadedRotation('2026-10-21T15:00:00Z', page521('| strike = 5\n'));
  const definition = EVENT_DEFINITION_MAP.jerryPerkpocalypse;

  const struck = definition.getSchedule(at('2026-10-21T15:20:00Z'), { mayor: JERRY, jerryRotation: rotation });
  assert.equal(struck.isActive, false);
  assert.equal(struck.windowStartAt, at('2026-10-21T21:15:00Z'));
  assert.equal(struck.rotationMayor, 'Marina');
  assert.deepEqual(definition.extraLines(struck), [
    'Now: no perks (slot cancelled)',
    `Next: Marina <t:${seconds(at('2026-10-21T21:15:00Z'))}:t>`
  ]);

  const unknown = definition.getSchedule(at('2026-10-21T15:00:00Z'), { mayor: JERRY });
  assert.equal(unknown.isActive, true);
  assert.equal(unknown.windowStartAt, at('2026-10-21T09:15:00Z'));
  assert.equal(unknown.rotationMayor, null);
  assert.equal(getReminderStatusLine(definition, unknown), "🔄 Jerry's Perkpocalypse: a new mayor's perks are active now.");
  assert.deepEqual(definition.extraLines(unknown), [
    'Now: unknown mayor (rotation order not published yet)',
    `Next: unknown mayor <t:${seconds(at('2026-10-21T15:15:00Z'))}:t>`,
    'Perks switch every 6 hours.'
  ]);
  assert.deepEqual(definition.reminderFields(unknown), []);
});

function createReminderFixture(clock, page) {
  let state = { eventReminders: { lastSentStarts: {}, messageIds: {}, messageExpireAts: {}, feastRotations: {} } };
  const sent = [];
  const bridge = [];
  let statusRefreshes = 0;
  const messages = new Collection();
  const channel = {
    id: 'channel',
    isTextBased: () => true,
    messages: { fetch: async (key) => (typeof key === 'object' ? messages : messages.get(key)) },
    send: async (payload) => {
      sent.push(payload);
      const id = String(sent.length);
      const message = {
        id,
        channelId: 'channel',
        author: { id: 'bot' },
        content: payload.content,
        embeds: payload.embeds.map((embed) => embed.toJSON()),
        createdTimestamp: clock.now(),
        delete: async () => messages.delete(id)
      };
      messages.set(id, message);
      return message;
    }
  };
  const store = {
    getEventReminderConfiguredGuildIds: () => ['guild'],
    getGuildConfig: () => ({ eventReminders: { channelId: 'channel', roles: { jerryPerkpocalypse: 'role' } } }),
    getGuildRuntimeState: () => state,
    setGuildRuntimeState: (_, patch) => { state = { ...state, ...patch }; },
    updateGuildRuntimeSection: (_, section, patch) => {
      state = { ...state, [section]: { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) } };
    }
  };
  const fake = createFakeFetch(() => ({ status: 200, body: page }));
  const jerryRotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });
  const service = createEventRemindersService({
    store,
    client: { user: { id: 'bot' }, channels: { fetch: async () => channel } },
    minecraft: { sendEventMessage: async (key, label, content) => bridge.push({ key, content }) },
    mayorAlerts: {
      getCachedElectionData: () => ({ mayor: JERRY }),
      getCachedElectionDataFetchedAt: () => clock.now(),
      refreshStatusForGuild: async () => { statusRefreshes += 1; }
    },
    jerryRotation,
    nowFn: clock.now,
    scheduleProvider: (now, context) => ({ jerryPerkpocalypse: EVENT_DEFINITION_MAP.jerryPerkpocalypse.getSchedule(now, context) })
  });
  return { service, sent, bridge, messages, fake, getStatusRefreshes: () => statusRefreshes };
}

test('reminders ping once per rotation switch, name the mayor and skip struck slots', async () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const fixture = createReminderFixture(clock, page521('| strike = 6\n'));

  await fixture.service.checkForReminders();
  assert.equal(fixture.fake.calls.length, 1);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].content, "<@&role>\n🔄 Diana's perks are active now (Jerry's Perkpocalypse).");
  assert.deepEqual(fixture.sent[0].allowedMentions, { roles: ['role'] });
  const embed = fixture.sent[0].embeds[0].toJSON();
  assert.equal(embed.title, "Jerry's Perkpocalypse is ACTIVE");
  assert.equal(embed.fields[0].name, "Diana's perks");
  assert.match(embed.fields[0].value, /\*\*Huntress' Intuition\*\*: Gain \+10 Tracking\./);
  assert.deepEqual(fixture.bridge, [{ key: 'jerryPerkpocalypse', content: "🔄 Diana's perks are active now (Jerry's Perkpocalypse)." }]);
  assert.equal(fixture.getStatusRefreshes(), 1);

  clock.set('2026-10-21T15:10:00Z');
  await fixture.service.checkForReminders();
  assert.equal(fixture.sent.length, 1);

  clock.set('2026-10-21T15:16:00Z');
  await fixture.service.checkForReminders();
  assert.equal(fixture.sent.length, 2);
  assert.match(fixture.sent[1].content, /Finnegan's perks are active now/);
  assert.equal(fixture.messages.has('1'), false);

  // Slot 6 (Marina) is struck on the wiki: no ping, and the Finnegan reminder is removed at its end.
  clock.set('2026-10-21T21:16:00Z');
  await fixture.service.checkForReminders();
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.messages.has('2'), false);

  clock.set('2026-10-22T03:16:00Z');
  await fixture.service.checkForReminders();
  assert.equal(fixture.sent.length, 3);
  assert.match(fixture.sent[2].content, /Cole's perks are active now/);
  // A complete order is re-read from the wiki every 6 hours (21:16 and 03:16).
  assert.equal(fixture.fake.calls.length, 3);
});

function createEmbeds(clock, jerryRotation = null) {
  return createMayorAlertEmbeds({ env, skyblock: createSkyblockUtils(), jerryRotation, now: clock.now });
}

test('status embed shows the Perkpocalypse field only while Jerry is mayor', async () => {
  const { rotation, clock } = await createLoadedRotation('2026-10-21T15:00:00Z');
  const embeds = createEmbeds(clock, rotation);

  const field = embeds.createMayorEmbed('🧨', JERRY, false).toJSON().fields
    .find((entry) => entry.name === 'Perkpocalypse');
  assert.ok(field);
  assert.equal(field.value, [
    "**Diana**: Huntress' Intuition, Mythological Ritual, Pet XP Buff, Sharing is Caring",
    `until <t:${seconds(at('2026-10-21T15:15:00Z'))}:t> (<t:${seconds(at('2026-10-21T15:15:00Z'))}:R>)`,
    `Next: Finnegan <t:${seconds(at('2026-10-21T15:15:00Z'))}:t> • Marina <t:${seconds(at('2026-10-21T21:15:00Z'))}:t> • Cole <t:${seconds(at('2026-10-22T03:15:00Z'))}:t>`,
    'Order: Cole → Aatrox → Paul → Diana → Finnegan → Marina'
  ].join('\n'));

  const paulFields = embeds.createMayorEmbed('🗝️', PAUL, false).toJSON().fields;
  assert.equal(paulFields.some((entry) => entry.name === 'Perkpocalypse'), false);

  assert.match(embeds.createEventCalendarEmbed(JERRY).toJSON().description, /\*\*Jerry's Perkpocalypse\*\* · /);
  assert.doesNotMatch(embeds.createEventCalendarEmbed(PAUL).toJSON().description, /Perkpocalypse/);
});

test('status embed falls back when the rotation order is not published', () => {
  const clock = createClock('2026-10-21T15:00:00Z');
  const fake = createFakeFetch(() => ({ status: 404, body: '' }));
  const rotation = createJerryRotation({ fetch: fake.fetch, now: clock.now, logger: createLogger().logger });

  for (const embeds of [createEmbeds(clock, rotation), createEmbeds(clock)]) {
    const field = embeds.createMayorEmbed('🧨', JERRY, false).toJSON().fields
      .find((entry) => entry.name === 'Perkpocalypse');
    assert.equal(field.value, `Rotation order not published yet — perks switch every 6 hours (next switch <t:${seconds(at('2026-10-21T15:15:00Z'))}:R>)`);
  }
});

test('status embed thumbnail is the mayor head, looked up by name because the API key is the role', () => {
  const embeds = createEmbeds(createClock('2026-10-21T15:00:00Z'));
  const thumbnail = (mayor) => embeds.createMayorEmbed('⚔️', mayor, false).toJSON().thumbnail?.url;

  assert.equal(thumbnail({ key: 'slayer', name: 'Aatrox', perks: [] }), env.MAYOR_HEADS.aatrox);
  assert.match(env.MAYOR_HEADS.aatrox, /^https:\/\/mc-heads\.net\/head\/[0-9a-f]{60,64}\/256$/);
  assert.equal(thumbnail(JERRY), 'https://mc-heads.net/head/MHF_Villager/256');
  assert.equal(thumbnail({ key: 'unknown', name: 'Nobody', perks: [] }), undefined);
});

test('the Perkpocalypse field stays within the Discord field limit', () => {
  const longName = 'Abcdefghijklmnopqrstuvwxyzabcdef';
  const mayors = Array.from({ length: 32 }, (_, index) => `|mayor${index + 1} = ${longName}`).join('\n');
  const rotation = parsePerkpocalypseWikitext(`{{Perkpocalypse|year=521\n${mayors}\n}}`, 521);
  const field = formatPerkpocalypseField(resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), JERRY, rotation));

  assert.ok(field.value.length <= 1024);
  assert.ok(field.value.endsWith('…'));
});

test('the Perkpocalypse field shows head emojis and never cuts one in half', async () => {
  const { rotation, clock } = await createLoadedRotation('2026-10-21T15:00:00Z');
  const appEmojis = createFakeAppEmojis({ mayor_diana: '1000000000000000001', mayor_finnegan: '1000000000000000002', mayor_cole: '1000000000000000003' });
  const embeds = createMayorAlertEmbeds({ env, skyblock: createSkyblockUtils(), jerryRotation: rotation, now: clock.now, appEmojis });
  const field = embeds.createMayorEmbed('🧨', JERRY, false).toJSON().fields.find((entry) => entry.name === 'Perkpocalypse');
  assert.match(field.value, /^<:mayor_diana:1000000000000000001> \*\*Diana\*\*: Huntress' Intuition/);
  assert.match(field.value, /Next: <:mayor_finnegan:1000000000000000002> Finnegan <t:\d+:t>/);
  assert.match(field.value, /Order: <:mayor_cole:1000000000000000003> Cole → Aatrox → Paul/);

  const longName = 'Abcdefghijklmnopqrstuvwxyzabcdef';
  const mayors = Array.from({ length: 32 }, (_, index) => `|mayor${index + 1} = ${longName}`).join('\n');
  const longRotation = parsePerkpocalypseWikitext(`{{Perkpocalypse|year=521\n${mayors}\n}}`, 521);
  const state = resolvePerkpocalypseState(at('2026-10-21T15:00:00Z'), JERRY, longRotation);
  for (let length = 0; length < 40; length += 1) {
    const icon = `<:m${'x'.repeat(length)}:1000000000000000000>`;
    const longField = formatPerkpocalypseField(state, { mayorIcon: () => icon });
    assert.ok(longField.value.length <= 1024);
    assert.ok(longField.value.endsWith('…'));
    assert.doesNotMatch(longField.value, /<[^<>]*…$/, 'no half token before the ellipsis');
  }
});
