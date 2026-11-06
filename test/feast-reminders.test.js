const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { createEventRemindersService } = require('../src/features/eventReminders');
function fixture() {
  const now = 1800000000000;
  let feast = { available: true, grand: true, crops: ['Wheat', 'Carrot', 'Potato', 'Pumpkin'], until: now + 3600000, upcoming: [[now + 3600000, ['Melon', 'Cactus', 'Mushroom', 'Nether Wart']]] };
  let state = { eventReminders: { lastSentStarts: {}, messageIds: {}, messageExpireAts: {}, feastRotations: {} } };
  const sent = [], edited = [];
  const messages = new Collection();
  const channel = { id: 'channel', isTextBased: () => true, messages: { fetch: async key => typeof key === 'object' ? messages : messages.get(key) }, send: async payload => {
    sent.push(payload); const id = String(sent.length);
    const message = { id, channelId: 'channel', author: { id: 'bot' }, embeds: payload.embeds.map(e => e.toJSON()), createdTimestamp: now, content: payload.content, delete: async () => messages.delete(id), edit: async p => { edited.push(p); message.embeds = p.embeds.map(e => e.toJSON()); } };
    messages.set(id, message); return message;
  } };
  const store = { getEventReminderConfiguredGuildIds: () => ['guild'], getGuildConfig: () => ({ eventReminders: { channelId: 'channel', roles: { grandFeast: 'role' } } }), getGuildRuntimeState: () => state, setGuildRuntimeState: (_, patch) => { state = { ...state, ...patch }; },
    updateGuildRuntimeSection: (_, section, patch) => { state = { ...state, [section]: { ...state[section], ...(typeof patch === 'function' ? patch(state[section]) : patch) } }; } };
  const deps = { store, client: { user: { id: 'bot' }, channels: { fetch: async () => channel } }, feastProvider: { getCurrent: async () => feast }, nowFn: () => now, scheduleProvider: () => ({ grandFeast: { isActive: true, windowStartAt: now - 1000, windowEndAt: now + 100000000 } }) };
  return { service: createEventRemindersService(deps), restart: () => createEventRemindersService(deps), setFeast: value => { feast = value; }, getFeast: () => feast, sent, edited, getState: () => state };
}
test('Grand Feast includes current/upcoming crops and sends exactly one ping per confirmed change across restart', async () => {
  const f = fixture();
  await f.service.checkForReminders();
  assert.equal(f.sent.length, 1);
  const fields = f.sent[0].embeds[0].toJSON().fields;
  assert.match(fields[0].value, /Wheat/);
  assert.match(fields[1].value, /Melon/);
  await f.service.checkForReminders();
  f.setFeast({ ...f.getFeast(), crops: [...f.getFeast().crops].reverse() });
  await f.service.checkForReminders();
  assert.equal(f.sent.length, 1);
  f.setFeast({ ...f.getFeast(), crops: ['Melon', 'Cactus', 'Mushroom', 'Nether Wart'] });
  await f.service.checkForReminders();
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[1].content, /new in-season crops/);
  assert.deepEqual(f.sent[1].allowedMentions, { roles: ['role'] });
  await f.restart().checkForReminders();
  assert.equal(f.sent.length, 2);
});
test('unavailable crops cause no change ping; first confirmed data enriches the existing reminder silently', async () => {
  const f = fixture(); const valid = f.getFeast();
  f.setFeast({ available: false });
  await f.service.checkForReminders();
  assert.match(f.sent[0].embeds[0].toJSON().fields[0].value, /No confirmed/);
  f.setFeast(valid);
  await f.service.checkForReminders();
  assert.equal(f.sent.length, 1);
  assert.equal(f.edited.length, 1);
  assert.deepEqual(f.edited[0].allowedMentions, { parse: [] });
  f.setFeast(null);
  await f.service.checkForReminders();
  assert.equal(f.sent.length, 1);
});
