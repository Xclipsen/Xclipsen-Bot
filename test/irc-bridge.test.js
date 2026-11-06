const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const { createIrcBridge } = require('../src/features/minecraft/ircBridge');

const linkStore = {
  async findBridgeLinkByMinecraftUsername(name) {
    return name === 'Linked' ? { discordUserId: '1', entry: { eventPreferences: { darkAuction: false } } } : null;
  }
};

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createBridge(overrides) {
  return createIrcBridge({
    client: {},
    linkStore,
    env: {
      IRC_BRIDGE_ENABLED: true,
      IRC_BRIDGE_HOST: '127.0.0.1',
      IRC_BRIDGE_PORT: 0,
      IRC_BRIDGE_CHANNEL_ID: null,
      IRC_BRIDGE_MAX_BUFFERED_MESSAGES: 250,
      ...overrides
    }
  });
}

test('the bridge stays disabled without a real auth token', async (t) => {
  for (const token of [null, '', 'change-me']) {
    const errors = t.mock.method(console, 'error', () => {});
    const bridge = createBridge({ IRC_BRIDGE_AUTH_TOKEN: token });
    await bridge.start();
    assert.match(errors.mock.calls[0].arguments[0], /IRC_BRIDGE_AUTH_TOKEN/);
    assert.equal(bridge.sendEventMessage('darkAuction', 'Dark Auction', 'Soon'), undefined);
    await bridge.stop();
    t.mock.restoreAll();
  }
});

test('with a token the bridge serves buffered events filtered by the linked player preferences', async (t) => {
  t.mock.method(console, 'log', () => {});
  const port = await getFreePort();
  const bridge = createBridge({ IRC_BRIDGE_AUTH_TOKEN: 'real-secret', IRC_BRIDGE_PORT: port });
  await bridge.start();
  t.after(() => bridge.stop());

  bridge.sendEventMessage('darkAuction', 'Dark Auction', 'Muted event');
  bridge.sendEventMessage('spookyFestival', 'Spooky Festival', 'Wanted event');
  const base = `http://127.0.0.1:${port}/api/messages`;

  const unauthorized = await fetch(`${base}?after=0&playerName=Linked`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${base}?after=0&playerName=Linked`, { headers: { authorization: 'Bearer real-secret' } });
  const payload = await response.json();
  assert.equal(payload.linked, true);
  assert.deepEqual(payload.messages.map((message) => [message.source, message.eventKey, message.title, message.content]), [
    ['event', 'spookyFestival', 'Spooky Festival', 'Wanted event']
  ]);

  const unlinked = await (await fetch(`${base}?after=0&playerName=Other`, { headers: { authorization: 'Bearer real-secret' } })).json();
  assert.deepEqual(unlinked, { linked: false, messages: [] });
});
