const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createNameHistoryApiService } = require('../src/namehistory-api/service');

const ALPHA = { uuid: '11111111-1111-4111-8111-111111111111', name: 'Alpha' };
const BETA = { uuid: '22222222-2222-4222-8222-222222222222', name: 'Beta' };
const OLD_DATE = '2020-01-01T00:00:00.000Z';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', ...headers }
});
const mojang = (profile) => json({ id: profile.uuid.replaceAll('-', ''), name: profile.name });
const isMojang = (url) => ['api.minecraftservices.com', 'api.mojang.com', 'sessionserver.mojang.com'].includes(new URL(url).host);
const laby = (profile, history = [{ name: 'BeforeAlpha', changed_at: OLD_DATE, accurate: true }]) => json({
  user: { uuid: profile.uuid, name: profile.name }, name_history: history
});
const crafty = (profile, history = [{ username: 'CraftyName', changed_at: OLD_DATE, hidden: false }]) => json({
  success: true, data: { uuid: profile.uuid, username: profile.name, usernames: history }
});

function cachedProfile(overrides = {}) {
  return {
    schema_version: 2,
    query: ALPHA.name,
    uuid: ALPHA.uuid,
    current_name: ALPHA.name,
    last_seen_at: OLD_DATE,
    fetched_at: OLD_DATE,
    history_source: 'laby',
    history: [{ id: 1, name: 'BeforeAlpha', changed_at: OLD_DATE, observed_at: OLD_DATE, accurate: true, censored: false }],
    ...overrides
  };
}

function setup(t, profile = null, config = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namehistory-test-'));
  const cacheFilePath = path.join(directory, 'cache.json');
  if (profile) {
    fs.writeFileSync(cacheFilePath, JSON.stringify({
      profiles: { [profile.uuid]: profile },
      nameIndex: { alpha: profile.uuid, beforealpha: profile.uuid, beta: profile.uuid }
    }));
  }
  const originalFetch = global.fetch;
  const requests = [];
  let handler = async (url) => isMojang(url) ? mojang(ALPHA) : laby(ALPHA);
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return handler(url, options);
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(cacheFilePath)) fs.unlinkSync(cacheFilePath);
    fs.rmdirSync(directory);
  });
  return {
    service: createNameHistoryApiService({
      cacheFilePath, requestTimeoutMs: 1000, staleMinutes: 1440,
      userAgent: 'namehistory-test', ...config
    }),
    requests,
    cacheFilePath,
    setHandler(value) { handler = value; },
    readCache() { return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8')); }
  };
}

test('history TTL uses fetch time, preserves uncertainty and does not call Crafty on valid Laby data', async (t) => {
  const h = setup(t);
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : laby(ALPHA, [
    { name: 'ExactName', changed_at: OLD_DATE, last_seen_at: OLD_DATE, accurate: true },
    { name: 'ApproxName', changed_at: OLD_DATE, last_seen_at: OLD_DATE, accurate: false },
    { name: 'Alpha', changed_at: OLD_DATE, last_seen_at: OLD_DATE, accurate: false }
  ]));
  const before = Date.now();
  const first = await h.service.getByUsername(' Alpha ');
  const second = await h.service.getByUsername('alpha');
  assert.equal(first.history_source, 'laby');
  assert.equal(first.history_status, 'fresh');
  assert.ok(Date.parse(first.fetched_at) >= before);
  assert.equal(first.last_seen_at, OLD_DATE);
  assert.equal(first.history.find((entry) => entry.name === 'ExactName').accurate, true);
  assert.equal(first.history.find((entry) => entry.name === 'ApproxName').accurate, false);
  assert.equal(first.history.find((entry) => entry.name === 'ApproxName').censored, false);
  assert.deepEqual(second.history, first.history);
  assert.equal(h.requests.filter(({ url }) => url.includes('laby.net')).length, 1);
  assert.equal(h.requests.filter(({ url }) => url.includes('crafty.gg')).length, 0);
  assert.equal(h.requests.filter(({ url }) => isMojang(url)).length, 2);
});

test('reused historical names cannot override the current Mojang account', async (t) => {
  const h = setup(t);
  h.setHandler((url) => {
    if (isMojang(url)) return mojang(url.endsWith('/Beta') ? BETA : ALPHA);
    if (url.includes(BETA.uuid)) return laby(BETA, [{ name: 'Beta', accurate: true }]);
    return laby(ALPHA, [{ name: 'Beta', accurate: true }, { name: 'Alpha', accurate: true }]);
  });
  assert.equal((await h.service.getByUsername('Beta')).uuid, BETA.uuid);
  assert.equal((await h.service.getByUsername('Alpha')).uuid, ALPHA.uuid);
  assert.equal((await h.service.getByUsername('Beta')).uuid, BETA.uuid);
  assert.equal(h.readCache().nameIndex.beta, BETA.uuid);
});

test('a current name reassigned after caching is resolved again before reading history', async (t) => {
  const h = setup(t, cachedProfile({ fetched_at: new Date().toISOString() }));
  h.setHandler((url) => isMojang(url) ? mojang({ ...BETA, name: 'Alpha' }) : laby(BETA));
  const result = await h.service.getByUsername('Alpha');
  assert.equal(result.uuid, BETA.uuid);
  assert.equal(h.requests.filter(({ url }) => url.includes('laby.net')).length, 1);
});

test('Mojang errors and invalid identity responses advance to the secondary endpoint', async (t) => {
  for (const failure of ['503', 'timeout', 'wrong-name', 'invalid-uuid']) {
    await t.test(failure, async (t) => {
      const h = setup(t);
      h.setHandler((url) => {
        if (url.includes('api.minecraftservices.com')) {
          if (failure === 'timeout') throw new DOMException('Request timed out', 'TimeoutError');
          if (failure === 'wrong-name') return mojang(BETA);
          if (failure === 'invalid-uuid') return json({ id: 'bad', name: 'Alpha' });
          return json({}, 503);
        }
        return isMojang(url) ? mojang(ALPHA) : laby(ALPHA);
      });
      assert.equal((await h.service.getByUsername('Alpha')).uuid, ALPHA.uuid);
      assert.equal(h.requests.filter(({ url }) => isMojang(url)).length, 2);
    });
  }
});

test('unavailable and not-found Mojang lookups cannot return a potentially reassigned cached name', async (t) => {
  for (const status of [503, 404, 204]) {
    await t.test(String(status), async (t) => {
      const h = setup(t, cachedProfile({ fetched_at: new Date().toISOString() }));
      h.setHandler(() => status === 204 ? new Response(null, { status }) : json({}, status));
      await assert.rejects(h.service.getByUsername('Alpha'), (error) => error.status === (status === 503 ? 503 : 404));
      assert.equal(h.requests.length, 2);
    });
  }
});

test('Crafty replaces unavailable or invalid Laby responses and receives only the verified UUID', async (t) => {
  for (const failure of ['503', '429', 'invalid-json', 'missing-history', 'wrong-uuid', 'invalid-entry', 'timeout']) {
    await t.test(failure, async (t) => {
      const h = setup(t, null, { craftyApiKey: 'test-crafty-key' });
      h.setHandler((url, options) => {
        if (isMojang(url)) return mojang(ALPHA);
        if (url.includes('laby.net')) {
          assert.equal(options.headers.Authorization, undefined);
          if (failure === 'invalid-json') return new Response('<html>error</html>');
          if (failure === 'missing-history') return json({ user: { uuid: ALPHA.uuid } });
          if (failure === 'wrong-uuid') return laby(BETA);
          if (failure === 'invalid-entry') return laby(ALPHA, [{ changed_at: OLD_DATE }]);
          if (failure === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
          return json({}, Number(failure));
        }
        assert.equal(url, `https://api.crafty.gg/api/v2/players/${ALPHA.uuid}`);
        assert.equal(options.headers.Authorization, 'Bearer test-crafty-key');
        return crafty(ALPHA, [
          { username: 'CraftyName', changed_at: OLD_DATE, hidden: false },
          { username: 'PrivateName', changed_at: OLD_DATE, hidden: true }
        ]);
      });
      const result = await h.service.getByUsername('Alpha');
      assert.equal(result.history_source, 'crafty');
      assert.equal(result.history_status, 'fresh');
      assert.equal(result.history.find((entry) => entry.name === 'CraftyName').accurate, false);
      assert.ok(!JSON.stringify(result).includes('PrivateName'));
      assert.ok(result.history.some((entry) => entry.censored));
      assert.equal(h.readCache().profiles[ALPHA.uuid].history_source, 'crafty');
    });
  }
});

test('both sources failing preserve the cached file, timestamp and names, with stale status', async (t) => {
  const h = setup(t, cachedProfile());
  const before = fs.readFileSync(h.cacheFilePath, 'utf8');
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : json({}, 503));
  const result = await h.service.getByUsername('Alpha');
  assert.equal(result.history_status, 'stale');
  assert.equal(result.history_source, 'laby');
  assert.equal(result.fetched_at, OLD_DATE);
  assert.ok(result.history.some((entry) => entry.name === 'BeforeAlpha'));
  assert.equal(fs.readFileSync(h.cacheFilePath, 'utf8'), before);
  await h.service.getByUsername('Alpha');
  assert.equal(h.requests.filter(({ url }) => !isMojang(url)).length, 2, 'brief failure cooldown avoids retrying both providers');
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : laby(ALPHA));
  assert.equal((await h.service.getByUsername('Alpha', { forceRefresh: true })).history_status, 'fresh');
});

test('missing cache and mismatched Crafty UUID return unavailable, without saving empty history', async (t) => {
  const h = setup(t);
  h.setHandler((url) => {
    if (isMojang(url)) return mojang(ALPHA);
    return url.includes('laby.net') ? json({}, 503) : crafty(BETA);
  });
  const result = await h.service.getByUsername('Alpha');
  assert.equal(result.uuid, ALPHA.uuid);
  assert.equal(result.history_status, 'unavailable');
  assert.equal(result.history_source, null);
  assert.deepEqual(result.history, []);
  assert.equal(fs.existsSync(h.cacheFilePath), false);
});

test('valid empty or hidden Laby history does not trigger fallback or merge cached names', async (t) => {
  for (const entries of [[], [{ name: '-', accurate: false }]]) {
    await t.test(entries.length ? 'hidden' : 'empty', async (t) => {
      const h = setup(t, cachedProfile());
      h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : laby(ALPHA, entries));
      const result = await h.service.getByUsername('Alpha');
      assert.equal(result.history_status, 'fresh');
      assert.ok(!result.history.some((entry) => entry.name === 'BeforeAlpha'));
      assert.equal(h.requests.filter(({ url }) => url.includes('crafty.gg')).length, 0);
    });
  }
});

test('known hidden entries prevent another provider from restoring hidden names during outages', async (t) => {
  const h = setup(t, cachedProfile({ history: [{ name: '-', censored: true, accurate: false }] }));
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : json({}, 503));
  const result = await h.service.getByUsername('Alpha');
  assert.equal(result.history_status, 'stale');
  assert.equal(h.requests.filter(({ url }) => url.includes('crafty.gg')).length, 0);
});

test('a previously empty history stays empty during a later provider outage', async (t) => {
  const h = setup(t);
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : laby(ALPHA, []));
  await h.service.getByUsername('Alpha');
  h.setHandler((url) => {
    if (isMojang(url)) return mojang(ALPHA);
    return url.includes('laby.net') ? json({}, 503) : crafty(ALPHA);
  });
  const result = await h.service.getByUsername('Alpha', { forceRefresh: true });
  assert.equal(result.history_status, 'stale');
  assert.deepEqual(result.history.map((entry) => entry.name), ['Alpha']);
  assert.equal(h.requests.filter(({ url }) => url.includes('crafty.gg')).length, 0);
});

test('a missing current name is appended after dated history without inventing a change date', async (t) => {
  const h = setup(t);
  const result = await h.service.getByUsername('Alpha');
  assert.deepEqual(result.history.map((entry) => entry.name), ['BeforeAlpha', 'Alpha']);
  assert.equal(result.history.at(-1).changed_at, null);
});

test('legacy cache remains available after outages without treating uncertain names as hidden', async (t) => {
  const oldProfile = cachedProfile({
    schema_version: undefined, fetched_at: undefined, history_source: undefined,
    history: [{ name: 'OldVisibleName', censored: true, changed_at: OLD_DATE, observed_at: OLD_DATE }]
  });
  const h = setup(t, oldProfile);
  h.setHandler((url) => isMojang(url) ? mojang(ALPHA) : json({}, 503));
  const result = await h.service.getByUsername('Alpha');
  assert.equal(result.history_status, 'stale');
  assert.equal(result.history_source, 'laby');
  assert.equal(result.history[0].name, 'OldVisibleName');
  assert.equal(result.history[0].censored, false);
  assert.equal(result.history[0].accurate, false);
  assert.equal(result.fetched_at, null);
  assert.equal(h.requests.filter(({ url }) => !isMojang(url)).length, 2);
});

test('an explicit UUID can use a clearly stale cached profile while Mojang is unavailable', async (t) => {
  const h = setup(t, cachedProfile());
  h.setHandler(() => json({}, 503));
  const result = await h.service.getByUuid(ALPHA.uuid);
  assert.equal(result.uuid, ALPHA.uuid);
  assert.equal(result.profile_stale, true);
  assert.equal(result.history_status, 'stale');
  assert.equal(h.requests.length, 2);
});

test('UUID lookup rejects a mismatching primary profile and uses the official secondary', async (t) => {
  const h = setup(t);
  h.setHandler((url) => {
    if (url.includes('sessionserver.mojang.com')) return mojang(BETA);
    return isMojang(url) ? mojang(ALPHA) : laby(ALPHA);
  });
  const result = await h.service.getByUuid(ALPHA.uuid.replaceAll('-', ''));
  assert.equal(result.uuid, ALPHA.uuid);
  assert.equal(result.profile_stale, false);
  assert.match(h.requests[1].url, /api\.minecraftservices\.com\/minecraft\/profile\/lookup\//);
});

test('Retry-After cooldown applies across different accounts without blocking other providers', async (t) => {
  for (const retryAfter of ['120', new Date(Date.now() + 120_000).toUTCString()]) {
    await t.test(retryAfter, async (t) => {
      const h = setup(t);
      h.setHandler((url) => {
        if (isMojang(url)) return mojang(url.endsWith('/Beta') ? BETA : ALPHA);
        if (url.includes('laby.net')) return json({}, 429, { 'retry-after': retryAfter });
        return crafty(url.includes(BETA.uuid) ? BETA : ALPHA);
      });
      assert.equal((await h.service.getByUsername('Alpha')).history_source, 'crafty');
      assert.equal((await h.service.getByUsername('Beta')).history_source, 'crafty');
      assert.equal(h.requests.filter(({ url }) => url.includes('laby.net')).length, 1);
      assert.equal(h.requests.filter(({ url }) => url.includes('crafty.gg')).length, 2);
    });
  }
});

test('concurrent history lookups share a single provider refresh', async (t) => {
  const h = setup(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const providerStarted = new Promise((resolve) => { started = resolve; });
  h.setHandler(async (url) => {
    if (isMojang(url)) return mojang(ALPHA);
    started();
    await gate;
    return laby(ALPHA);
  });
  const first = h.service.getByUsername('Alpha');
  await providerStarted;
  const second = h.service.getByUsername('alpha');
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].query, 'Alpha');
  assert.equal(results[1].query, 'alpha');
  assert.equal(h.requests.filter(({ url }) => url.includes('laby.net')).length, 1);
});

test('invalid input never makes a network request', async (t) => {
  const h = setup(t);
  await assert.rejects(h.service.getByUsername('not a name'), (error) => error.status === 400);
  await assert.rejects(h.service.getByUuid('invalid'), (error) => error.status === 400);
  assert.equal(h.requests.length, 0);
});

test('invalid top-level cache data can be replaced by a valid successful lookup', async (t) => {
  for (const value of [null, []]) {
    await t.test(JSON.stringify(value), async (t) => {
      const h = setup(t);
      fs.writeFileSync(h.cacheFilePath, JSON.stringify(value));
      const service = createNameHistoryApiService(h.service.config);
      assert.equal((await service.getByUsername('Alpha')).history_status, 'fresh');
      assert.equal(h.readCache().profiles[ALPHA.uuid].history[0].name, 'BeforeAlpha');
    });
  }
});
