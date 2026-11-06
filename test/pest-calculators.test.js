process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { env } = require('../src/config/env');
const { createBestPestFeature } = require('../src/features/bestPest');
const { createPestFarmingProfitFeature } = require('../src/features/pestFarmingProfit');
const { createHypixelApi } = require('../src/utils/hypixelApi');
const { createTempStore } = require('./helpers');

const USER = '123456789012345678';
const SNAPSHOT_FILE = path.join(__dirname, 'fixtures', 'pest-calculators.json');

const PRODUCT_IDS = [
  'ENCHANTED_RED_MUSHROOM', 'ENCHANTED_BROWN_MUSHROOM', 'ENCHANTED_NETHER_STALK', 'ENCHANTED_MELON', 'ENCHANTED_CARROT',
  'ENCHANTED_POTATO', 'ENCHANTED_PUMPKIN', 'ENCHANTED_COCOA', 'ENCHANTED_SUGAR', 'ENCHANTED_CACTUS_GREEN', 'ENCHANTED_WHEAT',
  'DUNG', 'HONEY_JAR', 'PLANT_MATTER', 'CHEESEBITE', 'COMPOST', 'WARTY',
  'MELON', 'SUGAR_CANE', 'PUMPKIN', 'CARROT_ITEM', 'POTATO_ITEM', 'RED_MUSHROOM', 'BROWN_MUSHROOM', 'CACTUS', 'NETHER_STALK',
  'WHEAT', 'MOONFLOWER', 'ENCHANTED_SUNFLOWER', 'WILD_ROSE'
];
// Fixed prices; the two enchanted mushrooms differ so pooled and summed values are distinguishable.
const BAZAAR = {
  success: true,
  products: Object.fromEntries(PRODUCT_IDS.map((productId, index) => {
    const sellPrice = productId === 'ENCHANTED_RED_MUSHROOM' ? 1000 : productId === 'ENCHANTED_BROWN_MUSHROOM' ? 600 : 3 + (index * 17.5);
    return [productId, { quick_status: { sellPrice, buyPrice: sellPrice * 1.25 } }];
  }))
};
const ELECTION = {
  success: true,
  mayor: { key: 'finnegan', name: 'Finnegan', perks: [{ name: '§aPest Eradicator' }], minister: { perk: { name: 'Farming Simulator' } } }
};

function fixture(t, { election = ELECTION } = {}) {
  const { store } = createTempStore(t, 'pest-calculators-');
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const body = String(url).includes('/bazaar') ? BAZAAR : String(url) === env.ELECTION_URL ? election : null;
    if (!body) {
      throw new Error(`unexpected fetch ${url}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };
  const hypixelApi = createHypixelApi({ env, fetchImpl });
  return {
    store,
    requested,
    bestPest: createBestPestFeature({ store, hypixelApi }),
    profit: createPestFarmingProfitFeature({ store, hypixelApi })
  };
}

async function run(handler, options = {}) {
  const replies = [];
  const interaction = {
    user: { id: USER },
    options: {
      getInteger: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null
    },
    deferReply: async () => {},
    reply: async (payload) => replies.push(payload),
    editReply: async (payload) => replies.push(payload)
  };
  await handler(interaction);
  assert.equal(replies.length, 1);
  const [reply] = replies;
  if (!reply.embeds) {
    return { content: reply.content };
  }

  const { title, description, fields, footer } = reply.embeds[0].toJSON();
  return JSON.parse(JSON.stringify({ title, description, fields, footer: footer?.text }));
}

const STATS = { bonus_pest_chance: 497, pest_shard_level: 7, cropeetle_level: 4, rarefinder_level: 9, reforge: 'bountiful' };
const PROFIT_SETUPS = {
  slugInstasell: { bait: 'plant_matter', vinyl: 'slug', crop: 'wheat', fortune: 2900, pest_fortune: 2600, plots: 2, sell_method: 'insta_sell' },
  slugSellOrder: { bait: 'plant_matter', vinyl: 'slug', crop: 'mushroom', fortune: 2900, plots: 3, sell_method: 'sell_order' },
  jellyNpc: { bait: 'jelly', vinyl: 'firefly', crop: 'cocoa_beans', fortune: 1800, plots: 1, sell_method: 'npc_sell' },
  moonflowerNpc: { bait: 'dung', vinyl: 'fly', crop: 'moonflower', fortune: 2400, plots: 4, sell_method: 'npc_sell' }
};

async function collectOutputs(f) {
  const outputs = {};
  outputs.pestWithoutStats = await run(f.bestPest.handleBestPestCommand, { fortune: 2500, sell_method: 'npc_sell' });
  outputs.profitWithoutStats = await run(f.profit.handlePestFarmingProfitsCommand, PROFIT_SETUPS.slugInstasell);
  outputs.setFarmingStats = await run(f.profit.handleSetFarmingStatsCommand, STATS);
  outputs.lastWithoutSetup = await run(f.profit.handleLastPestFarmingProfitsCommand);
  for (const sellMethod of ['insta_sell', 'sell_order', 'npc_sell']) {
    outputs[`pest_${sellMethod}`] = await run(f.bestPest.handleBestPestCommand, { fortune: 2500, sell_method: sellMethod });
  }
  outputs.pestLowFortune = await run(f.bestPest.handleBestPestCommand, { fortune: 0, sell_method: 'insta_sell' });
  for (const [name, setup] of Object.entries(PROFIT_SETUPS)) {
    outputs[`profit_${name}`] = await run(f.profit.handlePestFarmingProfitsCommand, setup);
  }
  outputs.lastProfit = await run(f.profit.handleLastPestFarmingProfitsCommand);
  return outputs;
}

test('pest calculators match the recorded outputs for fixed prices and mayor data', async (t) => {
  const f = fixture(t);
  const outputs = await collectOutputs(f);
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

test('both pest commands share one Bazaar and election response within the cache window', async (t) => {
  const f = fixture(t);
  await collectOutputs(f);
  assert.equal(f.requested.filter((url) => url.includes('/bazaar')).length, 1);
  assert.equal(f.requested.filter((url) => url === env.ELECTION_URL).length, 1);
});

test('Slug is worth the same per kill in /pest and /pestfarmingprofits (mushroom drops are one pooled choice)', async (t) => {
  const f = fixture(t);
  await run(f.profit.handleSetFarmingStatsCommand, STATS);
  const pest = await run(f.bestPest.handleBestPestCommand, { fortune: 2600, sell_method: 'insta_sell' });
  const profit = await run(f.profit.handlePestFarmingProfitsCommand, PROFIT_SETUPS.slugInstasell);
  const pestSlug = pest.description.match(/\*\*Slug\*\* - (\S+) per kill/)[1];
  const profitSlug = profit.description.match(/\*\*Slug\*\* \(.*\)\n.* × (\S+) = /)[1];
  assert.equal(pestSlug, '145.38K');
  assert.equal(profitSlug, pestSlug);
});

test('Pest Eradicator counts from Finnegan or as minister perk only', async (t) => {
  const cases = [
    [{ success: true, mayor: { key: 'finnegan', name: 'Finnegan', perks: [{ name: 'Blooming Business' }] } }, 'Disabled'],
    [{ success: true, mayor: { key: 'diana', name: 'Diana', perks: [{ name: 'Pest Eradicator' }] } }, 'Disabled'],
    [{ success: true, mayor: { key: 'diana', name: 'Diana', perks: [], minister: { key: 'finnegan', perk: { name: '§a☘ Pest  Eradicator' } } } }, 'Enabled']
  ];
  for (const [election, expected] of cases) {
    const f = fixture(t, { election });
    const pest = await run(f.bestPest.handleBestPestCommand, { fortune: 100, sell_method: 'npc_sell' });
    assert.match(pest.description, new RegExp(`Mayor Finnegan: ${expected} \\(Pest Eradicator\\)`));
  }
});

test('/setfarmingstats keeps saved Cropeetle and Rarefinder levels when they are omitted', async (t) => {
  const f = fixture(t);
  await run(f.profit.handleSetFarmingStatsCommand, STATS);
  const { cropeetle_level: _cropeetle, rarefinder_level: _rarefinder, ...withoutOptional } = STATS;
  const reply = await run(f.profit.handleSetFarmingStatsCommand, { ...withoutOptional, pest_shard_level: 3 });
  assert.deepEqual(reply.fields.map((field) => field.value).slice(1, 4), ['3 (+6% rare drops)', '4 (+8%)', '9 (+9%)']);
  assert.equal(f.store.getUserFarmingStats(USER).cropeetleLevel, 4);
});
