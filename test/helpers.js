const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/storage/store');

// A store on fresh files in a temp directory that is removed after the test.
function createTempStore(t, prefix = 'xclipsen-bot-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = {
    configFilePath: path.join(dir, 'config.json'),
    shitterFilePath: path.join(dir, 'shitter.json'),
    stateFilePath: path.join(dir, 'state.json')
  };
  return { dir, paths, store: createStore(paths) };
}

// Stand-in for src/utils/appEmojis.js with the given application emojis already loaded (name → id).
function createFakeAppEmojis(ids = {}) {
  return {
    get: (name, fallback = '') => (ids[name] ? `<:${name}:${ids[name]}>` : fallback),
    url: (name) => (ids[name] ? `https://cdn.discordapp.com/emojis/${ids[name]}.png` : null),
    has: (name) => Boolean(ids[name]),
    sync: async () => {}
  };
}

module.exports = { createTempStore, createFakeAppEmojis };
