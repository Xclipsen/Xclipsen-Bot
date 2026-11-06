const test = require('node:test');
const assert = require('node:assert/strict');
const { createPagedLists, paginateLines } = require('../src/features/pagedLists');
const { createShitterListFeature } = require('../src/features/shitterList');
test('pagination retains every list item and oversized text', () => {
  const lines = Array.from({ length: 250 }, (_, i) => `${i}: ${'x'.repeat(80)}`);
  const pages = paginateLines(lines);
  assert.ok(pages.every(page => page.length <= 3500));
  assert.equal(pages.join('\n'), lines.join('\n'));
  assert.equal(paginateLines(['x'.repeat(9000)]).join(''), 'x'.repeat(9000));
});
test('pages enforce ownership and recheck permissions', async () => {
  const viewer = createPagedLists(); let payload; let allowed = true;
  const interaction = { user: { id: 'owner' }, guildId: 'guild', update: async p => { payload = p; }, reply: async p => { payload = p; } };
  await viewer.open(interaction, { title: 'All entries', lines: ['a'.repeat(3500), 'last item'], guard: async () => allowed });
  const next = payload.components[0].toJSON().components[1].custom_id;
  await viewer.handle({ ...interaction, customId: next });
  assert.equal(payload.embeds[0].toJSON().description, 'last item');
  await viewer.handle({ ...interaction, user: { id: 'other' }, customId: next });
  assert.match(payload.content, /belongs to another user/);
  allowed = false; payload = null;
  await viewer.handle({ ...interaction, customId: next });
  assert.equal(payload, null);
});
test('shitter lists and entry selectors reach names and entries beyond 25', async () => {
  const entries = Array.from({ length: 48 }, (_, i) => ({ ign: `Player${i}`, normalizedIgn: `player${i}`, createdAt: new Date(1700000000000 + i * 1000).toISOString(), reason: 'reason', addedByUserId: 'owner', screenshots: [] }));
  entries.push(...Array.from({ length: 40 }, (_, i) => ({ ign: 'ManyEntries', normalizedIgn: 'manyentries', createdAt: new Date(1800000000000 + i * 1000).toISOString(), reason: `Reason ${i}`, addedByUserId: 'owner', screenshots: [] })));
  const feature = createShitterListFeature({ store: { getShitterEntries: () => entries }, pagedLists: createPagedLists() });
  let payload;
  const i = { user: { id: 'owner' }, guildId: 'guild', inGuild: () => true, update: async p => { payload = p; }, reply: async p => { payload = p; } };
  await feature.handlePagination({ ...i, customId: 'shitter-list-page:owner:3' });
  assert.match(payload.embeds[0].toJSON().footer.text, /Page 4\/4/);
  assert.ok(payload.components[0].toJSON().components[0].options.length > 0);
  await feature.handlePagination({ ...i, customId: 'shitter-entry-page:owner:manyentries:2' });
  assert.match(payload.embeds[0].toJSON().fields.find(f => f.name === 'Reason').value, /Reason 9/);
  assert.ok(payload.components.length <= 5);
  assert.equal(payload.components[2].toJSON().components[0].options.length, 10);
});
