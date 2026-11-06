process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createStore } = require('../src/storage/store');

const GUILD_ID = '123456789012345678';

function setup(t, files = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = {
    configFilePath: path.join(directory, 'config.json'),
    shitterFilePath: path.join(directory, 'shitter-list.json'),
    stateFilePath: path.join(directory, 'state.json')
  };
  for (const [key, content] of Object.entries(files)) {
    fs.writeFileSync(paths[key], typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { directory, paths, read: (key) => JSON.parse(fs.readFileSync(paths[key], 'utf8')) };
}

test('missing data files start empty', (t) => {
  const { paths } = setup(t);
  const store = createStore(paths);
  assert.deepEqual(store.getConfiguredGuildIds(), []);
  assert.deepEqual(store.getShitterEntries(GUILD_ID), []);
});

test('a corrupt data file refuses to load instead of being replaced by defaults', (t) => {
  for (const key of ['configFilePath', 'stateFilePath', 'shitterFilePath']) {
    const { paths } = setup(t, { [key]: '{"guilds": {' });
    assert.throws(() => createStore(paths), /not valid JSON/);
    assert.equal(fs.readFileSync(paths[key], 'utf8'), '{"guilds": {');
  }
});

test('saves replace the file atomically and leave no temp files', (t) => {
  const { directory, paths, read } = setup(t, { configFilePath: { guilds: { [GUILD_ID]: { channelId: '1' } } } });
  const store = createStore(paths);
  store.setGuildConfig(GUILD_ID, { roleId: '2' });
  assert.equal(read('configFilePath').guilds[GUILD_ID].roleId, '2');
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
});

test('a failing save keeps the previous file intact', (t) => {
  const original = { guilds: { [GUILD_ID]: { channelId: '1' } } };
  const { directory, paths, read } = setup(t, { configFilePath: original });
  const store = createStore(paths);
  t.mock.method(fs, 'renameSync', () => { throw new Error('simulated crash before rename'); });
  assert.throws(() => store.setGuildConfig(GUILD_ID, { roleId: '2' }), /simulated crash/);
  t.mock.restoreAll();
  assert.deepEqual(read('configFilePath'), original);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
});

test('configured guild id helpers filter by their section', (t) => {
  const { paths } = setup(t, {
    configFilePath: {
      guilds: {
        a: { channelId: '1' },
        b: { eventReminders: { channelId: '2' }, weather: { channelId: '3' } },
        c: { modUpdates: { channelId: '4', trackedRepos: [] }, miningEvents: { channelId: '5' } },
        d: { modUpdates: { channelId: '6' } }
      }
    }
  });
  const store = createStore(paths);
  assert.deepEqual(store.getConfiguredGuildIds(), ['a', 'b']);
  assert.deepEqual(store.getEventReminderConfiguredGuildIds(), ['b']);
  assert.deepEqual(store.getWeatherConfiguredGuildIds(), ['b']);
  assert.deepEqual(store.getMiningEventConfiguredGuildIds(), ['c']);
  assert.deepEqual(store.getModUpdateConfiguredGuildIds(), ['d']);
});

test('retired state sections are preserved untouched when state is saved', (t) => {
  const retired = {
    links: { users: { [GUILD_ID]: { minecraftUsernames: ['Someone'] } }, hypixelVerificationMigrationVersion: 1 },
    hideonleaf: { users: { Someone: { kills: 3 } } },
    mobModels: { users: { Someone: { enabled: true } } }
  };
  const { paths, read } = setup(t, {
    stateFilePath: { guilds: { legacy: { boothOpen: true } }, ...retired }
  });
  const store = createStore(paths);
  store.setGuildRuntimeState(GUILD_ID, { boothOpen: false });
  const saved = read('stateFilePath');
  assert.deepEqual(saved.links, retired.links);
  assert.deepEqual(saved.hideonleaf, retired.hideonleaf);
  assert.deepEqual(saved.mobModels, retired.mobModels);
  assert.deepEqual(saved.guilds.legacy, { boothOpen: true });
  assert.equal(saved.guilds[GUILD_ID].boothOpen, false);
});

test('runtime sections are updated one level deep without touching other sections', (t) => {
  const { paths, read } = setup(t);
  const store = createStore(paths);
  store.setGuildRuntimeState(GUILD_ID, { boothOpen: true, miningEvents: { pingChannelId: '1', pingMessageIds: { raffle: '2' } } });

  store.updateGuildRuntimeSection(GUILD_ID, 'miningEvents', { dashboardMessageId: '3' });
  store.updateGuildRuntimeSection(GUILD_ID, 'miningEvents', (latest) => ({ pingMessageIds: { ...latest.pingMessageIds, gwtwDwarven: '4' } }));

  const state = store.getGuildRuntimeState(GUILD_ID);
  assert.equal(state.boothOpen, true);
  assert.equal(state.miningEvents.pingChannelId, '1');
  assert.equal(state.miningEvents.dashboardMessageId, '3');
  assert.deepEqual(state.miningEvents.pingMessageIds, { raffle: '2', gwtwDwarven: '4' });
  assert.deepEqual(read('stateFilePath').guilds[GUILD_ID].miningEvents.pingMessageIds, { raffle: '2', gwtwDwarven: '4' });
});

test('the store loads without the feature modules', () => {
  const storePath = require.resolve('../src/storage/store');
  const { execFileSync } = require('node:child_process');
  const loaded = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(storePath)}); console.log(Object.keys(require.cache).filter((file) => file.includes('/src/features/') || file.includes('/node_modules/discord.js/')).length)`], { env: { ...process.env, DISCORD_TOKEN: 'test-token' } });
  assert.equal(String(loaded).trim(), '0');
});
