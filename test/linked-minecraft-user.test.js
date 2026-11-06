const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveMinecraftUsernameOption } = require('../src/features/linkedMinecraftUser');
const { createModBackendClient } = require('../src/utils/modBackend');

function interaction(player = null) {
  return {
    user: { id: '123456789012345678' },
    options: { getString: (name) => (name === 'player' ? player : null) }
  };
}

function mockBackend(t, respond) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return respond(url);
  };
  const backend = createModBackendClient({ MOD_BACKEND_URL: 'https://backend.example', MOD_BACKEND_AUTH_TOKEN: 'secret' });
  return { backend, requests };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function resolve(linkStore, player) {
  return resolveMinecraftUsernameOption({ interaction: interaction(player), linkStore, optionName: 'player' });
}

test('an explicit username skips the link lookup', async (t) => {
  const { backend, requests } = mockBackend(t, () => jsonResponse({ account: null }));
  assert.deepEqual(await resolve(backend, 'Given'), { username: 'Given', usedLinkedAccount: false });
  assert.equal(requests.length, 0);
});

test('the linked username is read from the mod backend', async (t) => {
  const { backend, requests } = mockBackend(t, () => jsonResponse({
    account: { minecraftUsernames: ['First', 'Preferred'], preferredMinecraftUsername: 'Preferred' }
  }));
  assert.deepEqual(await resolve(backend), { username: 'Preferred', usedLinkedAccount: true });
  assert.equal(requests[0].url, 'https://backend.example/api/bot/links?discordUserId=123456789012345678');
});

test('an unlinked user is told how to link through the Hypixel social menu', async (t) => {
  const { backend } = mockBackend(t, () => jsonResponse({ account: null }));
  await assert.rejects(resolve(backend), (error) => {
    assert.match(error.message, /Pass `player:`/);
    assert.match(error.message, /Profile → Social Media → Discord/);
    assert.match(error.message, /`\/link username:<ign>`/);
    return true;
  });
});

test('a legacy link asks for re-verification instead of using the old username', async (t) => {
  const { backend } = mockBackend(t, () => jsonResponse({
    account: { minecraftUsernames: ['Legacy'], requiresHypixelVerification: true }
  }));
  await assert.rejects(resolve(backend), /Re-verify it: .*`\/link username:Legacy`/);
});

test('backend failures produce a clear message instead of a crash', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { backend } = mockBackend(t, () => jsonResponse({ error: 'down' }, 503));
  await assert.rejects(resolve(backend), /Could not look up your linked Minecraft account right now\. Pass `player:`/);
});
