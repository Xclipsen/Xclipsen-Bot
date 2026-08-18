const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DISCORD_TOKEN ||= 'test-token';

const { createLinkingFeature } = require('../src/features/linking');

test('/link verifies one canonical account and returns its code ephemerally', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async () => new Response(JSON.stringify({
    success: true,
    player: { socialMedia: { links: { DISCORD: 'discord-user' } } }
  }), { headers: { 'content-type': 'application/json' } });

  const account = {
    uuid: '12345678-1234-1234-1234-1234567890ab',
    name: 'CanonicalName'
  };
  let upsert;
  const store = {
    async linkVerifiedBridgeMinecraftAccount(discordUserId, minecraftAccount, metadata) {
      upsert = { discordUserId, minecraftAccount, metadata };
      return {
        ok: true,
        account: { minecraftUsernames: [minecraftAccount.name] },
        modLink: {
          code: 'AbcdEFGH_234567890-wxy',
          expiresAt: Date.now() + 60_000,
          account: minecraftAccount
        }
      };
    }
  };
  const replies = [];
  const interaction = {
    user: { id: '123', username: 'discord-user', globalName: 'Discord User', discriminator: '0' },
    options: {
      getString(name) { return name === 'username' ? 'InputName' : null; },
      getBoolean() { return null; }
    },
    async deferReply(payload) { replies.push({ type: 'defer', payload }); },
    async editReply(payload) { replies.push({ type: 'edit', payload }); }
  };
  const feature = createLinkingFeature({
    store,
    env: { HYPIXEL_API_KEY: 'hypixel-key' },
    minecraft: { async resolvePlayerProfile() { return account; } }
  });

  await feature.handleLinkCommand(interaction);

  assert.deepEqual(upsert.minecraftAccount, account);
  assert.equal(upsert.discordUserId, '123');
  assert.deepEqual(replies[0], { type: 'defer', payload: { ephemeral: true } });
  assert.match(replies[1].payload.content, /\/irc link AbcdEFGH_234567890-wxy/);
});
