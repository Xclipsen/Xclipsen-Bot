process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createModUpdatesService } = require('../src/features/modUpdates');
const { interactionIds } = require('../src/config/interactionIds');

const GUILD_ID = 'guild';

function setup(t, trackedRepos = ['https://github.com/odtheking/Odin', 'owner/NoRelease']) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    if (url.includes('NoRelease')) {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify({
      html_url: 'https://github.com/odtheking/Odin/releases/tag/v1',
      name: 'v1',
      published_at: '2026-10-01T00:00:00Z'
    }), { status: 200 });
  };
  const config = { modUpdates: { channelId: null, roleId: null, trackedRepos } };
  const opened = [];
  const service = createModUpdatesService({
    client: {},
    store: { getGuildConfig: () => config },
    pagedLists: { open: async (interaction, options) => opened.push(options) }
  });
  return { service, urls, config, opened };
}

function viewAllInteraction() {
  return {
    customId: interactionIds.MOD_RELEASES_ALL_ID,
    guildId: GUILD_ID,
    isButton: () => true,
    inGuild: () => true,
    deferReply: async () => {}
  };
}

test('release statuses only call the latest-release endpoint and build the repo URL locally', async (t) => {
  const { service, urls } = setup(t);
  const statuses = await service.fetchTrackedReleaseStatuses(GUILD_ID);
  assert.deepEqual(urls.sort(), [
    'https://api.github.com/repos/odtheking/Odin/releases/latest',
    'https://api.github.com/repos/owner/NoRelease/releases/latest'
  ]);
  assert.deepEqual(statuses.map((status) => [status.fullName, status.repoUrl, status.hasRelease, status.errorMessage]), [
    ['odtheking/Odin', 'https://github.com/odtheking/Odin', true, null],
    ['owner/NoRelease', 'https://github.com/owner/NoRelease', false, null]
  ]);
});

test('"View all releases" reuses the last check and refetches only when the tracked repos changed', async (t) => {
  const { service, urls, config, opened } = setup(t);
  await service.fetchTrackedReleaseStatuses(GUILD_ID);
  urls.length = 0;

  assert.equal(await service.handleViewAllReleasesButton(viewAllInteraction()), true);
  assert.equal(urls.length, 0);
  assert.equal(opened[0].lines.length, 2);

  config.modUpdates.trackedRepos = ['owner/NoRelease'];
  await service.handleViewAllReleasesButton(viewAllInteraction());
  assert.deepEqual(urls, ['https://api.github.com/repos/owner/NoRelease/releases/latest']);
  assert.equal(opened[1].lines.length, 1);
});

test('other interactions are not handled by the release button', async (t) => {
  const { service } = setup(t);
  assert.equal(await service.handleViewAllReleasesButton({ ...viewAllInteraction(), customId: 'other' }), false);
});
