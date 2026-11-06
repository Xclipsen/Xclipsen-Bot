process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { env } = require('../src/config/env');
const { createCatacombsFeature } = require('../src/features/catacombs');
const { createTrophyFishingFeature } = require('../src/features/trophyFishing');
const { createHypixelApi } = require('../src/utils/hypixelApi');

const UUID = '0123456789abcdef0123456789abcdef';
const SNAPSHOT_FILE = path.join(__dirname, 'fixtures', 'skyblock-profiles.json');

const CATACOMBS_MEMBER = {
  dungeons: {
    secrets: 5321,
    selected_dungeon_class: 'mage',
    player_classes: { healer: { experience: 120000 }, mage: { experience: 250000000 }, berserk: { experience: 3500000 }, archer: { experience: 0 }, tank: { experience: 900 } },
    dungeon_types: {
      catacombs: {
        experience: 590000000,
        tier_completions: { 0: 3, 1: 30, 2: 52, 3: 101, 4: 77, 5: 260, 6: 501, 7: 1200, total: 2224 },
        fastest_time_s_plus: { 5: 145230, 6: 162001, 7: 251999 },
        watcher_kills: { total: 12345 }
      },
      master_catacombs: {
        tier_completions: { 1: 4, 5: 70, 7: 333 },
        fastest_time_s_plus: { 7: 301777 }
      }
    }
  },
  nether_island_player_data: { kuudra_completed_tiers: { none: 40, hot: 70, infernal: 12, highest_wave_none: 9 } }
};
const TROPHY_MEMBER = {
  trophy_fish: {
    total_caught: 4321,
    blobfish: 900, blobfish_bronze: 850, blobfish_silver: 40, blobfish_gold: 9, blobfish_diamond: 1,
    sulphur_skitter: 120, sulphur_skitter_bronze: 110, sulphur_skitter_silver: 10,
    golden_fish: 3, golden_fish_bronze: 2, golden_fish_gold: 1
  },
  leveling: { completed_tasks: ['TROPHY_COMMON_FROG_BRONZE', 'TROPHY_COMMON_FROG_GOLD', 'TROPHY_LEAP_FROG_SILVER', 'TROPHY_PUDDLE_JUMPER_DIAMOND'] },
  inventory: { sacks_counts: { COMMON_FROG_BRONZE: 12, COMMON_FROG_GOLD: 1 } },
  player_stats: { items_fished: { trophy_frog: 77 } }
};
const PROFILES = [
  { profile_id: 'aaaaaaaa-0000-4000-8000-000000000001', cute_name: 'Apple', selected: false, members: { [UUID]: { ...CATACOMBS_MEMBER } } },
  {
    profile_id: 'bbbbbbbb-0000-4000-8000-000000000002',
    cute_name: 'Banana',
    selected: true,
    members: { [UUID]: { ...TROPHY_MEMBER, dungeons: { dungeon_types: { catacombs: { experience: 1000 } } } } }
  }
];

function fixture(t, profiles = PROFILES) {
  const testEnv = { ...env, HYPIXEL_API_KEY: 'test-key' };
  const requested = [];
  const hypixelApi = createHypixelApi({
    env: testEnv,
    fetchImpl: async (url) => {
      requested.push(String(url));
      return { ok: true, status: 200, json: async () => ({ success: true, profiles }) };
    }
  });
  const minecraft = { resolvePlayerProfile: async (name) => ({ uuid: UUID, name: name === 'linked' ? 'LinkedName' : 'TestPlayer' }) };
  const linkStore = { getBridgeLinkedAccount: async () => ({ minecraftUsernames: ['linked'] }) };
  return {
    requested,
    catacombs: createCatacombsFeature({ env: testEnv, minecraft, linkStore, hypixelApi }),
    trophy: createTrophyFishingFeature({ minecraft, linkStore, hypixelApi })
  };
}

function embedJson(embed) {
  const { title, description, fields, footer } = embed.toJSON();
  return JSON.parse(JSON.stringify({ title, description, fields, footer: footer?.text }));
}

let nextMessageId = 1;

async function runCommand(handler, options = {}) {
  const replies = [];
  const message = { id: String(nextMessageId++), content: '' };
  await handler({
    user: { id: '123456789012345678' },
    options: { getString: (name) => options[name] ?? null },
    deferReply: async () => {},
    editReply: async (payload) => { replies.push(payload); return message; },
    fetchReply: async () => message
  });
  assert.equal(replies.length, 1);
  return { ...replies[0], message: { ...message, content: replies[0].content || '' } };
}

async function runComponent(handler, { customId, values = [], kind = 'button', message }) {
  const calls = [];
  const record = (type) => async (payload) => { calls.push({ type, payload }); };
  const handled = await handler({
    customId,
    values,
    message,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    reply: record('reply'),
    update: record('update'),
    deferReply: record('deferReply'),
    deferUpdate: record('deferUpdate'),
    editReply: record('editReply'),
    followUp: record('followUp')
  });
  return { handled, calls };
}

function componentIds(reply) {
  return reply.components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
}

async function collectEmbeds(f) {
  const outputs = {};
  const cata = await runCommand(f.catacombs.handleCatacombsCommand, { player: 'TestPlayer', profile: 'apple' });
  outputs.cataBasic = embedJson(cata.embeds[0]);
  outputs.cataSelected = embedJson((await runCommand(f.catacombs.handleCatacombsCommand, { player: 'TestPlayer' })).embeds[0]);
  outputs.cataUnknownProfile = (await runCommand(f.catacombs.handleCatacombsCommand, { player: 'TestPlayer', profile: 'Cherry' })).content;
  const linked = await runCommand(f.catacombs.handleCatacombsCommand, {});
  outputs.cataLinkedContent = linked.content;
  const fish = await runCommand(f.trophy.handleTrophyFishingCommand, { player: 'TestPlayer' });
  outputs.fishOverview = embedJson(fish.embeds[0]);
  const frogs = await runCommand(f.trophy.handleTrophyFrogsCommand, { player: 'TestPlayer' });
  outputs.frogOverview = embedJson(frogs.embeds[0]);
  return { outputs, replies: { cata, fish, frogs } };
}

function lastPayload(calls) {
  return calls.filter((call) => ['reply', 'update', 'editReply'].includes(call.type)).at(-1).payload;
}

test('catacombs and trophy overviews match the recorded embeds', async (t) => {
  const f = fixture(t);
  const { outputs, replies } = await collectEmbeds(f);

  const boss = await runComponent(f.catacombs.handleCatacombsViewButton, { customId: componentIds(replies.cata)[1], message: replies.cata.message });
  outputs.cataBoss = embedJson(lastPayload(boss.calls).embeds[0]);
  const fishInfo = await runComponent(f.trophy.handleTrophyFishSelect, { customId: componentIds(replies.fish)[0], values: ['blobfish'], kind: 'select', message: replies.fish.message });
  outputs.fishInfo = embedJson(lastPayload(fishInfo.calls).embeds[0]);
  const frogInfo = await runComponent(f.trophy.handleTrophyFrogSelect, { customId: componentIds(replies.frogs)[0], values: ['common_frog'], kind: 'select', message: replies.frogs.message });
  outputs.frogInfo = embedJson(lastPayload(frogInfo.calls).embeds[0]);

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(outputs, null, 2)}\n`);
  }

  const expected = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  for (const key of Object.keys(expected)) {
    assert.deepEqual(outputs[key], expected[key], key);
  }
  assert.deepEqual(Object.keys(outputs), Object.keys(expected));
});

test('view buttons and info selects carry player and profile, so they work after a restart', async (t) => {
  const first = fixture(t);
  const cata = await runCommand(first.catacombs.handleCatacombsCommand, { player: 'TestPlayer', profile: 'Apple' });
  const fish = await runCommand(first.trophy.handleTrophyFishingCommand, { player: 'TestPlayer' });
  const ids = [...componentIds(cata), ...componentIds(fish)];
  assert.deepEqual(ids, [
    `cata:basic:${UUID}:aaaaaaaa000040008000000000000001:TestPlayer`,
    `cata:boss:${UUID}:aaaaaaaa000040008000000000000001:TestPlayer`,
    `trophy-fish-select:${UUID}:bbbbbbbb000040008000000000000002`
  ]);
  assert.ok(`cata:basic:${UUID}:${'f'.repeat(32)}:${'n'.repeat(16)}`.length <= 100);

  const restarted = fixture(t);
  const boss = await runComponent(restarted.catacombs.handleCatacombsViewButton, { customId: ids[1], message: { id: 'other', content: '' } });
  assert.equal(boss.handled, true);
  assert.equal(boss.calls[0].type, 'update');
  assert.equal(boss.calls[0].payload.embeds[0].toJSON().title, "TestPlayer's Boss Collections on Apple");

  const info = await runComponent(restarted.trophy.handleTrophyFishSelect, { customId: ids[2], values: ['blobfish'], kind: 'select', message: { id: 'other' } });
  assert.deepEqual(info.calls.map((call) => call.type), ['deferReply', 'editReply']);
  assert.match(info.calls[1].payload.embeds[0].toJSON().fields[0].value, /^Bronze: 850\n/);
});

test('buttons and selects from older bot versions ask to rerun the command', async (t) => {
  const f = fixture(t);
  for (const customId of ['catacombs-view-basic', 'catacombs-view-boss-collections', 'cata:boss:broken']) {
    const result = await runComponent(f.catacombs.handleCatacombsViewButton, { customId, message: { id: 'old' } });
    assert.equal(result.handled, true);
    assert.match(result.calls[0].payload.content, /expired\. Run `\/cata` again/);
  }
  const fish = await runComponent(f.trophy.handleTrophyFishSelect, { customId: 'trophy-fish-select', values: ['blobfish'], kind: 'select', message: { id: 'old' } });
  assert.match(fish.calls[0].payload.content, /expired\. Run `\/trophyfishing` again/);
  const frog = await runComponent(f.trophy.handleTrophyFrogSelect, { customId: 'trophy-frog-select', values: ['common_frog'], kind: 'select', message: { id: 'old' } });
  assert.match(frog.calls[0].payload.content, /expired\. Run `\/trophyfrogs` again/);
  assert.equal((await runComponent(f.catacombs.handleCatacombsViewButton, { customId: 'setup-view-main', message: { id: 'x' } })).handled, false);
  assert.equal(f.requested.length, 0);
});

test('profile choice: Hypixel-selected first, then most Catacombs XP for /cata and the first profile for trophies', async (t) => {
  const unselected = PROFILES.map((profile) => ({ ...profile, selected: false })).reverse();
  const f = fixture(t, unselected);
  const cata = await runCommand(f.catacombs.handleCatacombsCommand, { player: 'TestPlayer' });
  assert.equal(cata.embeds[0].toJSON().title, "TestPlayer's Catacombs on Apple");
  const fish = await runCommand(f.trophy.handleTrophyFishingCommand, { player: 'TestPlayer' });
  assert.equal(fish.embeds[0].toJSON().title, "TestPlayer's Trophy Fish on Banana");
  assert.equal(f.requested.length, 1, 'profiles are cached per player');
});
