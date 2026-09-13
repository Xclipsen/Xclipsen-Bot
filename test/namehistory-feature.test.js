const assert = require('node:assert/strict');
const test = require('node:test');

const { createNameHistoryFeature } = require('../src/features/nameHistory');

const PROFILE = {
  uuid: '12345678-1234-1234-1234-1234567890ab',
  name: 'CurrentName',
  createdAt: null,
  history: [],
  historySource: 'laby',
  historySourceLabel: 'Laby.net',
  historyStatus: 'fresh',
  fetchedAt: '2026-09-01T12:00:00.000Z',
  profileStale: false
};

async function runCommand({ profile = PROFILE, player = 'RequestedName', linkedAccount = null, error } = {}) {
  const replies = [];
  const requestedNames = [];
  const linkedUserIds = [];
  const feature = createNameHistoryFeature({
    minecraft: {
      async fetchNameHistory(username) {
        requestedNames.push(username);
        if (error) {
          throw error;
        }
        return profile;
      },
      formatUuid(uuid) { return uuid; }
    },
    store: {
      async getBridgeLinkedAccount(userId) {
        linkedUserIds.push(userId);
        return linkedAccount;
      }
    }
  });
  await feature.handleNameHistoryCommand({
    user: { id: 'discord-user' },
    options: { getString(name) { return name === 'player' ? player : null; } },
    async deferReply() { replies.push({ type: 'defer' }); },
    async editReply(payload) {
      replies.push({
        type: 'edit',
        payload: { ...payload, embeds: payload.embeds?.map((embed) => embed.toJSON()) }
      });
    }
  });
  return { replies, requestedNames, linkedUserIds, reply: replies.at(-1).payload };
}

test('/namehistory shows distinct visible past names and marks uncertain dates', async () => {
  const { reply } = await runCommand({
    profile: {
      ...PROFILE,
      historySource: 'crafty',
      historySourceLabel: 'Crafty.gg',
      history: [
        { name: 'exactname', changedAt: '2021-01-01T12:00:00Z', accurate: true },
        { name: 'ApproxName', changedAt: '2024-01-01T12:00:00Z', accurate: false },
        { name: 'UnknownAccuracy', changedAt: '2022-01-01T12:00:00Z' },
        { name: 'NoDate', changedAt: null, accurate: false },
        { name: 'ExactName', changedAt: '2023-01-01T12:00:00Z', accurate: true },
        { name: 'currentname', changedAt: '2025-01-01T12:00:00Z', accurate: true },
        { name: '-', censored: true },
        { name: 'HiddenName', censored: true }
      ]
    }
  });

  const embed = reply.embeds[0];
  assert.match(embed.description, /Past Names: `4`/);
  assert.match(embed.description, /1\. ApproxName \(approx\. Jan 1, 2024\)/);
  assert.match(embed.description, /2\. ExactName \(Jan 1, 2023\)/);
  assert.match(embed.description, /3\. UnknownAccuracy \(approx\. Jan 1, 2022\)/);
  assert.match(embed.description, /4\. NoDate\n/);
  assert.doesNotMatch(embed.description, /HiddenName|\d+\. -|\d+\. currentname|\d+\. exactname/);
  assert.match(embed.description, /Some names are hidden by the source/);
  assert.match(embed.description, /History Source: `Crafty\.gg`/);
  assert.match(embed.footer.text, /History: Crafty\.gg/);
  assert.equal(embed.thumbnail.url, `https://mc-heads.net/avatar/${PROFILE.uuid}/256`);
});

test('/namehistory distinguishes unavailable history from no recorded names', async () => {
  const { reply } = await runCommand({
    profile: {
      ...PROFILE,
      historyStatus: 'unavailable',
      historySource: null,
      historySourceLabel: 'Unavailable',
      fetchedAt: null
    }
  });

  const description = reply.embeds[0].description;
  assert.match(description, /Past Names: `Unknown`/);
  assert.match(description, /History Source: `Unavailable`/);
  assert.match(description, /Name history is temporarily unavailable/);
  assert.doesNotMatch(description, /No previous names|History Fetched|```/);
});

test('/namehistory labels cached history and a stale current profile', async () => {
  const { reply } = await runCommand({
    profile: {
      ...PROFILE,
      historyStatus: 'stale',
      profileStale: true,
      history: [{ name: 'OldName', changedAt: null }]
    }
  });

  const embed = reply.embeds[0];
  assert.match(embed.description, /Last Known Name: `CurrentName`/);
  assert.match(embed.description, /Current profile could not be refreshed/);
  assert.match(embed.description, /History refresh failed; showing cached names/);
  assert.match(embed.description, /1\. OldName/);
  const timestamp = Math.floor(new Date(PROFILE.fetchedAt).getTime() / 1000);
  assert.ok(embed.description.includes(`History Fetched: <t:${timestamp}:f>`));
  assert.match(embed.footer.text, /Cached Minecraft profile/);
  assert.doesNotMatch(embed.footer.text, /Current profile from Mojang/);
});

test('/namehistory reports a successful empty history without an outage warning', async () => {
  const { reply } = await runCommand();
  const description = reply.embeds[0].description;
  assert.match(description, /Past Names: `0`/);
  assert.match(description, /No previous names recorded by this source/);
  assert.doesNotMatch(description, /unavailable|refresh failed/);
});

test('/namehistory does not describe hidden names as an empty history', async () => {
  const { reply } = await runCommand({
    profile: { ...PROFILE, history: [{ name: '-', censored: true }] }
  });
  const description = reply.embeds[0].description;
  assert.match(description, /Past Names: `0`/);
  assert.match(description, /Some names are hidden by the source/);
  assert.match(description, /No visible previous names available/);
  assert.doesNotMatch(description, /No previous names recorded|1\. -/);
});

test('/namehistory truncates long histories at complete rows within the Discord limit', async () => {
  const history = Array.from({ length: 150 }, (_, index) => ({
    name: `PastName${index}`.padEnd(16, '_'),
    changedAt: new Date(Date.UTC(2010, index, 1, 12)).toISOString(),
    accurate: false
  }));
  const { reply } = await runCommand({ profile: { ...PROFILE, history } });
  assert.equal(reply.embeds.length, 1);
  const description = reply.embeds[0].description;
  assert.ok(description.length < 4096);
  assert.ok(description.endsWith('\n```'));
  assert.match(description, /Past Names: `150`/);
  assert.match(description, /1\. PastName149_+/);
  const omitted = Number(description.match(/\.\.\. (\d+) more names omitted\./)[1]);
  const visible = description.match(/^\d+\. PastName\d+_+ \(approx\. [^)]+\)$/gm).length;
  assert.ok(omitted > 0);
  assert.equal(visible + omitted, history.length);
});

test('/namehistory keeps prioritized linked account lookup and its notice', async () => {
  const { replies, reply, requestedNames, linkedUserIds } = await runCommand({
    player: null,
    linkedAccount: { preferredMinecraftUsername: 'PreferredName', minecraftUsernames: ['OtherName'] }
  });
  assert.deepEqual(requestedNames, ['PreferredName']);
  assert.deepEqual(linkedUserIds, ['discord-user']);
  assert.deepEqual(replies[0], { type: 'defer' });
  assert.equal(reply.content, 'Using linked username `CurrentName`.');
  assert.equal(reply.embeds.length, 1);
});

test('/namehistory displays structured service errors', async () => {
  const { reply } = await runCommand({
    error: { status: 404, body: { description: 'Username not found' } }
  });
  assert.equal(reply.content, 'Username not found');
  assert.equal(reply.embeds, undefined);
});
