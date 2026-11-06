const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFeast, createHarvestFeastFeature, skyblockDate } = require('../src/features/harvestFeast');
const { EPOCH_MS, YEAR_MS, MONTH_MS: MONTH } = require('../src/utils/skyblockTime');
// Early Autumn 1 of SkyBlock Year 514.
const start = EPOCH_MS + 513 * YEAR_MS + 6 * MONTH;
const crops = ['Wheat', 'Carrot', 'Potato', 'Pumpkin'];
const nextCrops = ['Melon', 'Cactus', 'Mushroom', 'Nether Wart'];
function fixture() {
  return { year: 514, month: 7, complete: true, current: crops,
    next: Object.fromEntries(nextCrops.map(c => [c, (start + MONTH) / 1000])), isGrandFeast: false };
}
test('current season and exact monthly transition use the correct four crops', () => {
  assert.deepEqual(resolveFeast(fixture(), start).crops, crops);
  assert.equal(resolveFeast(fixture(), start).until, start + MONTH);
  assert.deepEqual(resolveFeast(fixture(), start + MONTH).crops, nextCrops);
});
test('reject stale, future, incomplete and malformed data', () => {
  for (const changes of [{ year: 513 }, { year: 515 }, { month: 8 }, { complete: false },
    { current: ['Wheat'] }, { current: ['Wheat', 'Wheat', 'Potato', 'Pumpkin'] },
    { next: { Wheat: '123' } }, { next: [] }]) {
    assert.equal(resolveFeast({ ...fixture(), ...changes }, start).available, false);
  }
  assert.equal(resolveFeast({ ...fixture(), next: {} }, start + MONTH).available, false);
  assert.equal(resolveFeast(fixture(), start + MONTH * 2).available, false);
});
test('missing fourth crop after rotation is unavailable', () => {
  const data = fixture();
  delete data.next.Melon;
  assert.equal(resolveFeast(data, start + MONTH).available, false);
});
test('Grand Feast allows crops outside autumn and null timestamps end at month boundary', () => {
  const data = { ...fixture(), month: 6, isGrandFeast: true, next: { Wheat: null } };
  assert.equal(resolveFeast(data, start - 1).available, true);
  assert.equal(resolveFeast(data, start - 1).until, start);
  assert.equal(resolveFeast({ ...data, isGrandFeast: false }, start - 1).available, false);
});
test('latest reached rotation wins when multiple timestamps have passed', () => {
  const data = fixture();
  data.month = 8;
  for (const crop of ['Cocoa Beans', 'Sugar Cane', 'Sunflower', 'Moonflower']) data.next[crop] = (start + MONTH * 2) / 1000;
  assert.deepEqual(resolveFeast(data, start + MONTH * 2).crops, ['Cocoa Beans', 'Sugar Cane', 'Sunflower', 'Moonflower']);
});
test('commands share requests, render upcoming crops, and disable mentions', async () => {
  let calls = 0;
  const feature = createHarvestFeastFeature({ now: () => start, fetchImpl: async () => {
    calls++; return { ok: true, json: async () => fixture() };
  } });
  const replies = [];
  const interaction = commandName => ({ commandName, deferReply: async () => {}, editReply: async r => replies.push(r) });
  await Promise.all([feature.handleCommand(interaction('season')), feature.handleCommand(interaction('harvestfeast'))]);
  assert.equal(calls, 1);
  assert.match(replies[0].embeds[0].toJSON().description, /Wheat/);
  assert.ok(replies[1].embeds[0].toJSON().fields.some(f => f.name === 'Upcoming crops'));
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
});
test('API failures give an honest unavailable response and a retry cooldown', async () => {
  let calls = 0;
  const feature = createHarvestFeastFeature({ now: () => start, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  const interaction = { commandName: 'season', deferReply: async () => {}, editReply: async r => {
    assert.match(r.embeds[0].toJSON().description, /No confirmed current crops/);
  } };
  await feature.handleCommand(interaction);
  await feature.handleCommand(interaction);
  assert.equal(calls, 1);
});
test('SkyBlock dates use the displayed year and a 1-based month', () => {
  assert.deepEqual(skyblockDate(start), { year: 514, month: 7, end: start + MONTH });
  assert.deepEqual(skyblockDate(start - 1), { year: 514, month: 6, end: start });
  assert.deepEqual(skyblockDate(EPOCH_MS + 514 * YEAR_MS), { year: 515, month: 1, end: EPOCH_MS + 514 * YEAR_MS + MONTH });
});
test('without crop data the reply shows the regular autumn window from the calendar', async () => {
  const fieldAt = async (time) => {
    let reply;
    const feature = createHarvestFeastFeature({ now: () => time, fetchImpl: async () => { throw new Error('offline'); } });
    await feature.handleCommand({ commandName: 'harvestfeast', deferReply: async () => {}, editReply: async r => { reply = r; } });
    return reply.embeds[0].toJSON().fields.find(f => f.name === 'Regular Harvest Feast').value;
  };
  const stamp = ms => `<t:${Math.floor(ms / 1000)}:R>`;
  assert.equal(await fieldAt(start), `Autumn window active; ends ${stamp(start + 3 * MONTH)}.`);
  assert.equal(await fieldAt(start - 1), `Next autumn window starts ${stamp(start)}.`);
  assert.equal(await fieldAt(start + 3 * MONTH), `Next autumn window starts ${stamp(start + YEAR_MS)}.`);
});
