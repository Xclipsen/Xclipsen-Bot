const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Collection } = require('discord.js');

const { env } = require('../src/config/env');
const { EVENT_CATALOG } = require('../src/config/eventDefinitions');
const { ISLAND_ICONS, MINING_EVENT_DEFINITIONS } = require('../src/config/miningEventDefinitions');
const { createAppEmojis, loadAppEmojiManifest, NO_APP_EMOJIS } = require('../src/utils/appEmojis');
const { EVENT_DEFINITION_MAP, formatCalendarDescription, getCalendarEntries } = require('../src/features/eventCalendar');
const { createEventRemindersService } = require('../src/features/eventReminders');
const { createMayorAlertData } = require('../src/features/mayorAlerts/data');
const { createMayorAlertEmbeds } = require('../src/features/mayorAlerts/embeds');
const { createSkyblockUtils } = require('../src/utils/skyblock');
const { createFakeAppEmojis } = require('./helpers');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createLogger() {
  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    logger: {
      log: (...args) => lines.log.push(args.join(' ')),
      warn: (...args) => lines.warn.push(args.join(' ')),
      error: (...args) => lines.error.push(args.map(String).join(' '))
    }
  };
}

// Application emoji manager as exposed by discord.js (client.application.emojis).
function createFakeEmojiManager(existing = [], { failFetch = false, failNames = [] } = {}) {
  const created = [];
  let nextId = 100;
  return {
    created,
    deleted: [],
    async fetch() {
      if (failFetch) {
        throw new Error('Missing Access');
      }
      return new Collection(existing.map((emoji) => [emoji.id, emoji]));
    },
    async create({ attachment, name }) {
      if (failNames.includes(name)) {
        throw new Error('Invalid Form Body');
      }
      assert.ok(Buffer.isBuffer(attachment));
      created.push(name);
      nextId += 1;
      return { id: String(nextId), name, animated: false };
    },
    async delete(emoji) {
      this.deleted.push(emoji);
    }
  };
}

const ENTRIES = ['sb_one', 'sb_two', 'mayor_three'].map((name) => ({ name, filePath: `/icons/${name}.png` }));
const readFile = async () => Buffer.from('png');

test('the sync uploads only missing manifest emojis and keeps existing and foreign ones', async () => {
  const manager = createFakeEmojiManager([
    { id: '11', name: 'sb_one', animated: false },
    { id: '12', name: 'someone_elses', animated: true }
  ]);
  const { logger, lines } = createLogger();
  const appEmojis = createAppEmojis({ entries: ENTRIES, readFile, logger });

  assert.equal(appEmojis.get('sb_one', '🎃'), '🎃', 'fallback before ready');
  assert.equal(appEmojis.url('sb_one'), null);

  await appEmojis.sync({ application: { emojis: manager } });

  assert.deepEqual(manager.created, ['sb_two', 'mayor_three']);
  assert.deepEqual(manager.deleted, []);
  assert.equal(appEmojis.get('sb_one', '🎃'), '<:sb_one:11>');
  assert.equal(appEmojis.get('sb_two'), '<:sb_two:101>');
  assert.equal(appEmojis.get('mayor_three'), '<:mayor_three:102>');
  assert.equal(appEmojis.get('someone_elses'), '<a:someone_elses:12>');
  assert.equal(appEmojis.url('sb_one'), 'https://cdn.discordapp.com/emojis/11.png');
  assert.equal(appEmojis.get('unknown', '⭐'), '⭐');
  assert.equal(appEmojis.get(null, '🎭'), '🎭');
  assert.deepEqual(lines.error, []);
  assert.match(lines.log[0], /Application emojis ready: 3\/3 \(2 uploaded\)/);

  await appEmojis.sync({ application: { emojis: manager } });
  assert.equal(manager.created.length, 2, 'a second sync uploads nothing');
});

test('a failed emoji load or upload falls back to Unicode and is logged once', async () => {
  const { logger, lines } = createLogger();
  const offline = createAppEmojis({ entries: ENTRIES, readFile, logger });
  await offline.sync({ application: { emojis: createFakeEmojiManager([], { failFetch: true }) } });
  assert.equal(offline.get('sb_one', '🎃'), '🎃');
  assert.equal(lines.error.length, 1);

  const noApplication = createAppEmojis({ entries: ENTRIES, readFile, logger });
  await noApplication.sync({});
  assert.equal(noApplication.get('sb_one', '🎃'), '🎃');
  assert.equal(lines.warn.length, 1);

  lines.error.length = 0;
  const manager = createFakeEmojiManager([], { failNames: ['sb_one', 'sb_two'] });
  const partial = createAppEmojis({ entries: ENTRIES, readFile, logger });
  await partial.sync({ application: { emojis: manager } });
  assert.equal(partial.get('sb_one', '🎃'), '🎃');
  assert.equal(partial.get('mayor_three', '👤'), '<:mayor_three:101>');
  assert.equal(lines.error.length, 1);
  assert.match(lines.error[0], /Could not upload 2 application emojis \(sb_one, sb_two\)/);

  assert.equal(NO_APP_EMOJIS.get('sb_one', '🎃'), '🎃');
  assert.equal(NO_APP_EMOJIS.url('sb_one'), null);
});

test('oversized emoji files are not uploaded', async () => {
  const { logger, lines } = createLogger();
  const manager = createFakeEmojiManager();
  const appEmojis = createAppEmojis({ entries: ENTRIES.slice(0, 1), readFile: async () => Buffer.alloc(300 * 1024), logger });
  await appEmojis.sync({ application: { emojis: manager } });
  assert.deepEqual(manager.created, []);
  assert.match(lines.error[0], /larger than 256 KB/);
});

test('the manifest covers every icon in use with small, valid PNG files', () => {
  const entries = loadAppEmojiManifest();
  const names = new Set(entries.map((entry) => entry.name));
  assert.ok(entries.length <= 2000);

  for (const entry of entries) {
    const buffer = fs.readFileSync(entry.filePath);
    assert.ok(buffer.length <= 256 * 1024, `${entry.name} is too large`);
    assert.deepEqual(buffer.subarray(0, 8), PNG_SIGNATURE, `${entry.name} is not a PNG`);
    assert.ok(buffer.readUInt32BE(16) <= 128 && buffer.readUInt32BE(20) <= 128, `${entry.name} is larger than 128 px`);
  }

  const usedIcons = [
    ...EVENT_CATALOG.map((definition) => definition.icon),
    ...MINING_EVENT_DEFINITIONS.map((definition) => definition.icon).filter(Boolean),
    ...Object.values(ISLAND_ICONS),
    ...Object.keys(env.MAYOR_HEADS).map((mayor) => `mayor_${mayor}`)
  ];
  for (const icon of usedIcons) {
    assert.ok(names.has(icon), `${icon} is missing from assets/app-emojis/manifest.json`);
  }
  assert.equal(EVENT_CATALOG.every((definition) => definition.icon), true, 'every calendar event has an icon');
});

test('the manifest rejects invalid emoji names and file paths', (t) => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'app-emojis-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifestPath = path.join(dir, 'manifest.json');

  fs.writeFileSync(manifestPath, JSON.stringify({ 'Bad-Name': { file: 'a.png' } }));
  assert.throws(() => loadAppEmojiManifest(manifestPath), /Invalid application emoji name/);

  fs.writeFileSync(manifestPath, JSON.stringify({ sb_ok: { file: '../a.png' } }));
  assert.throws(() => loadAppEmojiManifest(manifestPath), /needs a file name/);
});

test('the calendar shows item icons and keeps whole entries within the description limit', () => {
  const entries = getCalendarEntries(Date.parse('2026-10-21T15:00:00Z'));
  const appEmojis = createFakeAppEmojis({ sb_spooky_festival: '1533218992414789753' });
  const description = formatCalendarDescription(entries, { getIcon: (entry) => appEmojis.get(entry.icon, entry.emoji) });

  assert.match(description, /^<:sb_spooky_festival:1533218992414789753> \*\*Spooky Festival\*\* · <t:\d+:R>\n<t:\d+:f> – <t:\d+:t> · 1 hour$/m);
  assert.match(description, /^🎂 \*\*New Year Celebration\*\*/m, 'Unicode fallback without an application emoji');
  assert.match(description, /^SkyBlock Year: \d+$/m);
  assert.ok(description.length <= 4096);

  const short = formatCalendarDescription(entries, { maxLength: 300 });
  assert.ok(short.length <= 300);
  assert.match(short, /\n…and \d+ more events$/);
  assert.doesNotMatch(short.replace(/\n…and \d+ more events$/, ''), /<t:\d*$/);
  assert.equal(formatCalendarDescription([]), 'No event data found.');
});

test('active calendar entries show now and their end', () => {
  const definition = EVENT_DEFINITION_MAP.spookyFestival;
  const startAt = Date.parse('2026-10-21T15:00:00Z');
  const entry = { key: definition.key, label: definition.label, emoji: definition.emoji, isActive: true, windowStartAt: startAt, windowEndAt: startAt + 3_600_000 };
  const description = formatCalendarDescription([entry]);
  assert.equal(description, [
    `🎃 **Spooky Festival** · **now** · ends <t:${(startAt + 3_600_000) / 1000}:R>`,
    `<t:${startAt / 1000}:f> – <t:${(startAt + 3_600_000) / 1000}:t> · 1 hour`
  ].join('\n'));
});

function createReminderFixture(appEmojis) {
  const now = 1_800_000_000_000;
  let state = { eventReminders: { lastSentStarts: {}, messageIds: {}, messageExpireAts: {}, feastRotations: {} } };
  const sent = [];
  const bridge = [];
  const messages = new Collection();
  const channel = {
    id: 'channel',
    isTextBased: () => true,
    messages: { fetch: async (key) => (typeof key === 'object' ? messages : messages.get(key)) },
    send: async (payload) => {
      sent.push(payload);
      const id = `new-${sent.length}`;
      messages.set(id, { id, channelId: 'channel', author: { id: 'bot' }, content: payload.content, embeds: payload.embeds.map((embed) => embed.toJSON()), createdTimestamp: now, delete: async () => messages.delete(id) });
      return messages.get(id);
    }
  };
  const store = {
    getEventReminderConfiguredGuildIds: () => ['guild'],
    getGuildConfig: () => ({ eventReminders: { channelId: 'channel', roles: { spookyFestival: 'role' } } }),
    getGuildRuntimeState: () => state,
    updateGuildRuntimeSection: (_, section, patch) => {
      state = { ...state, [section]: { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) } };
    }
  };
  const service = createEventRemindersService({
    store,
    client: { user: { id: 'bot' }, channels: { fetch: async () => channel } },
    minecraft: { sendEventMessage: async (key, label, content) => bridge.push(content) },
    nowFn: () => now,
    scheduleProvider: () => ({ spookyFestival: { key: 'spookyFestival', isActive: true, windowStartAt: now - 1000, windowEndAt: now + 3_600_000 } }),
    appEmojis
  });
  return { service, sent, bridge, messages };
}

test('event reminders use the item icon on Discord but plain text for Minecraft', async () => {
  const appEmojis = createFakeAppEmojis({ sb_spooky_festival: '1533218992414789753' });
  const fixture = createReminderFixture(appEmojis);
  // A reminder posted by an older bot version is still found by its title and replaced.
  fixture.messages.set('old', { id: 'old', author: { id: 'bot' }, content: '<@&role>\n🎃 Spooky Festival is active now.', embeds: [{ title: '🎃 Spooky Festival is ACTIVE' }], createdTimestamp: 1, delete: async () => fixture.messages.delete('old') });

  await fixture.service.checkForReminders();

  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].content, '<@&role>\n<:sb_spooky_festival:1533218992414789753> Spooky Festival is active now.');
  const embed = fixture.sent[0].embeds[0].toJSON();
  assert.equal(embed.title, 'Spooky Festival is ACTIVE');
  assert.equal(embed.thumbnail.url, 'https://cdn.discordapp.com/emojis/1533218992414789753.png');
  assert.deepEqual(fixture.bridge, ['🎃 Spooky Festival is active now.']);
  assert.doesNotMatch(fixture.bridge[0], /<:/);
  assert.equal(fixture.messages.has('old'), false);
});

test('event reminders keep the Unicode emoji without application emojis', async () => {
  const fixture = createReminderFixture(undefined);
  await fixture.service.checkForReminders();
  assert.equal(fixture.sent[0].content, '<@&role>\n🎃 Spooky Festival is active now.');
  assert.equal(fixture.sent[0].embeds[0].toJSON().thumbnail, undefined);
});

const HEAD_IDS = { mayor_aatrox: '1000000000000000001', mayor_paul: '1000000000000000002', mayor_diana: '1000000000000000003' };

test('the status embed puts head emojis in front of mayor names and keeps a Unicode title', () => {
  const appEmojis = createFakeAppEmojis(HEAD_IDS);
  const embeds = createMayorAlertEmbeds({ env, skyblock: createSkyblockUtils(), appEmojis });
  const mayor = {
    key: 'slayer',
    name: 'Aatrox',
    perks: [],
    minister: { key: 'dungeons', name: 'Paul', perk: { name: 'EZPZ', description: '' } }
  };
  const election = { candidates: [{ key: 'mythological', name: 'Diana', votes: 10, perks: [] }, { key: 'x', name: 'Nobody', votes: 5, perks: [] }] };

  const json = embeds.createMayorEmbed(appEmojis.get('mayor_aatrox'), mayor, true, election).toJSON();
  const field = (name) => json.fields.find((entry) => entry.name === name).value;
  assert.equal(json.title, `${env.MAYOR_EMOJIS.aatrox} SkyBlock Status Update`);
  assert.equal(field('Mayor'), '<:mayor_aatrox:1000000000000000001> Aatrox (slayer)');
  assert.equal(field('Minister'), '<:mayor_paul:1000000000000000002> Paul - EZPZ');
  assert.match(field('Election Candidates'), /^<:mayor_diana:1000000000000000003> Diana\n/m);
  assert.match(field('Election Candidates'), /^Nobody\n/m, 'no head, no emoji');

  const options = embeds.createCandidateSelectComponents(election)[0].toJSON().components[0].options;
  assert.deepEqual(options[0].emoji, { id: '1000000000000000003', name: 'mayor_diana', animated: false });
  assert.equal(options[1].emoji, undefined);

  const candidate = embeds.createCandidatePerkEmbed({ key: 'mythological', name: 'Diana', perks: [] }, appEmojis.get('mayor_diana')).toJSON();
  assert.equal(candidate.title, `${env.MAYOR_EMOJIS.diana} Diana Perks`);
});

test('the status embed without application emojis looks like before', () => {
  const embeds = createMayorAlertEmbeds({ env, skyblock: createSkyblockUtils() });
  const mayor = { key: 'slayer', name: 'Aatrox', perks: [], minister: { name: 'Paul', perk: { name: 'EZPZ', description: '' } } };
  const json = embeds.createMayorEmbed('⚔️', mayor, false).toJSON();
  assert.equal(json.title, '⚔️ SkyBlock Status Update');
  assert.equal(json.fields[0].value, 'Aatrox (slayer)');
  assert.equal(json.fields[1].value, 'Paul - EZPZ');
});

function createMayorData({ guildEmojis = new Collection(), appEmojis } = {}) {
  const channel = { id: 'channel', isTextBased: () => true, guild: { emojis: { fetch: async () => guildEmojis, cache: guildEmojis } } };
  return createMayorAlertData({
    client: { channels: { fetch: async () => channel } },
    env,
    store: { getGuildConfig: () => ({ channelId: 'channel', eventReminders: { channelId: null } }) },
    skyblock: createSkyblockUtils(),
    resolvedMayorEmojiCache: new Map(),
    hypixelApi: {},
    appEmojis
  });
}

test('mayor emojis prefer a guild emoji, then the head application emoji, then Unicode', async (t) => {
  t.mock.method(console, 'log', () => {});
  const appEmojis = createFakeAppEmojis(HEAD_IDS);
  const aatrox = { key: 'slayer', name: 'Aatrox' };
  const guildEmoji = { name: 'mayor_aatrox', toString: () => '<:mayor_aatrox:42>' };

  assert.equal(await createMayorData({ guildEmojis: new Collection([['42', guildEmoji]]), appEmojis }).getMayorEmoji('g', aatrox), '<:mayor_aatrox:42>');
  assert.equal(await createMayorData({ appEmojis }).getMayorEmoji('g', aatrox), '<:mayor_aatrox:1000000000000000001>');
  assert.equal(await createMayorData().getMayorEmoji('g', aatrox), env.MAYOR_EMOJIS.aatrox);

  const resolver = await createMayorData({ appEmojis }).getMayorIconResolver('g');
  assert.equal(resolver({ name: 'Paul' }), '<:mayor_paul:1000000000000000002>');
  assert.equal(resolver({ name: 'Nobody' }), '');
});
