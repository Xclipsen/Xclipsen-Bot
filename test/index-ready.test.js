const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

// Boots src/index.js in a child process with a stubbed Discord login and network,
// then fires the ready event with one guild whose command registration fails.
const BOOT_SCRIPT = `
const path = require('node:path');
const { Client, Events } = require('discord.js');
const handlers = {};
Client.prototype.login = async () => 'stubbed';
const originalOnce = Client.prototype.once;
Client.prototype.once = function (event, handler) { handlers[event] = handler; return originalOnce.call(this, event, handler); };
global.fetch = async () => { throw new Error('offline'); };
const intervals = [];
global.setInterval = (fn, ms) => { intervals.push(ms); return 0; };
console.error = () => {};
console.warn = () => {};
const { env } = require('./src/config/env');
const dataDir = process.env.TEST_DATA_DIR;
env.CONFIG_FILE_PATH = path.join(dataDir, 'config.json');
env.STATE_FILE_PATH = path.join(dataDir, 'state.json');
env.SHITTER_FILE_PATH = path.join(dataDir, 'shitter-list.json');
env.IRC_BRIDGE_ENABLED = false;
require('./src/index.js');
const registered = [];
const guild = (id, fail) => ({ id, name: 'g' + id, commands: { set: async () => { if (fail) throw new Error('Missing Access'); registered.push(id); } } });
const guilds = new Map([['1', guild('1', true)], ['2', guild('2', false)]]);
handlers[Events.ClientReady]({ user: { tag: 'bot#0' }, guilds: { cache: { map: (fn) => [...guilds.values()].map(fn), values: () => guilds.values() } } })
  .then(() => { process.stdout.write('RESULT ' + JSON.stringify({ registered, intervals }) + '\\n'); process.exit(0); });
`;

test('a guild that fails command registration does not stop the others or the scheduled checks', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-ready-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['-e', BOOT_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DISCORD_TOKEN: 'test-token', TEST_DATA_DIR: dataDir },
    encoding: 'utf8',
    timeout: 30_000
  });
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('RESULT '));
  assert.ok(line, `boot did not finish: ${result.stderr}`);
  const { registered, intervals } = JSON.parse(line.slice('RESULT '.length));
  assert.deepEqual(registered, ['2']);
  assert.ok(intervals.length >= 6, `expected the scheduled checks to start, got ${intervals.length}`);
});
