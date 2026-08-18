const assert = require('node:assert/strict');
const test = require('node:test');

const { createModBackendClient } = require('../src/utils/modBackend');

const ACCOUNT = {
  uuid: '12345678-1234-1234-1234-1234567890ab',
  name: 'CanonicalName'
};

test('upsert sends the verified profile and accepts a valid short-lived code', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    const payload = url.endsWith('/api/bot/links/upsert')
      ? { ok: true, account: { minecraftUsernames: [ACCOUNT.name] } }
      : { code: 'AbcdEFGH_234567890-wxy', expiresAt: Date.now() + 60_000, account: ACCOUNT };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  };

  const client = createModBackendClient({
    MOD_BACKEND_URL: 'https://backend.example/',
    MOD_BACKEND_AUTH_TOKEN: 'secret'
  });
  const result = await client.linkVerifiedBridgeMinecraftAccount('123', ACCOUNT, {
    discordUsername: 'discord-user',
    discordDisplayName: 'Discord User'
  });

  assert.equal(requests[0].url, 'https://backend.example/api/bot/links/upsert');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    discordUserId: '123',
    minecraftUsernames: ['CanonicalName'],
    minecraftAccounts: [ACCOUNT],
    discordUsername: 'discord-user',
    discordDisplayName: 'Discord User'
  });
  assert.equal(requests[1].url, 'https://backend.example/api/bot/links/issue-code');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    discordUserId: '123',
    minecraftUuid: ACCOUNT.uuid
  });
  assert.equal(result.modLink.code, 'AbcdEFGH_234567890-wxy');
});

test('upsert rejects malformed or expired credential responses without exposing values', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  let requestCount = 0;
  global.fetch = async () => {
    requestCount++;
    return new Response(JSON.stringify(requestCount === 1
      ? { ok: true, account: {} }
      : { code: 'sensitive-invalid-code', expiresAt: Date.now() - 1, account: ACCOUNT }), {
      headers: { 'content-type': 'application/json' }
    });
  };

  const client = createModBackendClient({
    MOD_BACKEND_URL: 'https://backend.example',
    MOD_BACKEND_AUTH_TOKEN: 'secret'
  });

  await assert.rejects(
    client.linkVerifiedBridgeMinecraftAccount('123', ACCOUNT),
    (error) => error.message === 'Mod backend returned an invalid link-code response.' &&
      !error.message.includes('sensitive-invalid-code')
  );
});

test('upsert bounds and strips control characters from a rejected account link', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error: `Account conflict\n${'x'.repeat(250)}`
  }), { headers: { 'content-type': 'application/json' } });

  const client = createModBackendClient({
    MOD_BACKEND_URL: 'https://backend.example',
    MOD_BACKEND_AUTH_TOKEN: 'secret'
  });
  const result = await client.linkVerifiedBridgeMinecraftAccount('123', ACCOUNT);

  assert.equal(result.ok, false);
  assert.equal(result.error.length, 200);
  assert.doesNotMatch(result.error, /[\u0000-\u001f\u007f]/);
});
