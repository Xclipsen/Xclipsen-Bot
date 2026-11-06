const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DISCORD_TOKEN ||= 'test-token';

const { MessageFlags } = require('discord.js');
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
  const linkStore = {
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
    user: { id: '123', username: 'discord-user', tag: 'discord-user', globalName: 'Discord User', discriminator: '0' },
    options: {
      getString(name) { return name === 'username' ? 'InputName' : null; },
      getBoolean() { return null; }
    },
    async deferReply(payload) { replies.push({ type: 'defer', payload }); },
    async editReply(payload) { replies.push({ type: 'edit', payload }); }
  };
  const feature = createLinkingFeature({
    linkStore,
    env: { HYPIXEL_API_KEY: 'hypixel-key', USER_AGENT: 'test-agent' },
    minecraft: { async resolvePlayerProfile() { return account; } }
  });

  await feature.handleLinkCommand(interaction);

  assert.deepEqual(upsert.minecraftAccount, account);
  assert.equal(upsert.discordUserId, '123');
  assert.deepEqual(replies[0], { type: 'defer', payload: { flags: MessageFlags.Ephemeral } });
  assert.match(replies[1].payload.content, /\/irc link AbcdEFGH_234567890-wxy/);
});

test('/link explains how to link when no account is linked and rejects a mismatched Hypixel Discord', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push(options.headers);
    return new Response(JSON.stringify({ success: true, player: { socialMedia: { links: { DISCORD: 'someone-else' } } } }), { headers: { 'content-type': 'application/json' } });
  };
  const replies = [];
  const user = { id: '123', username: 'discord-user', tag: 'discord-user', discriminator: '0' };
  const feature = createLinkingFeature({
    linkStore: { async getBridgeLinkedAccount() { return null; } },
    env: { HYPIXEL_API_KEY: 'hypixel-key', USER_AGENT: 'test-agent' },
    minecraft: { async resolvePlayerProfile() { return { uuid: 'abc', name: 'Player' }; } }
  });
  const interaction = (username) => ({
    user,
    options: { getString: (name) => (name === 'username' ? username : null), getBoolean: () => null },
    async reply(payload) { replies.push(payload); },
    async deferReply() {},
    async editReply(payload) { replies.push(payload); }
  });

  await feature.handleLinkCommand(interaction(null));
  assert.match(replies[0].content, /Profile → Social Media → Discord/);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);

  await feature.handleLinkCommand(interaction('Player'));
  assert.match(replies[1].content, /Hypixel has `someone-else`, but your Discord is `discord-user`/);
  assert.equal(requests[0]['User-Agent'], 'test-agent');
});
