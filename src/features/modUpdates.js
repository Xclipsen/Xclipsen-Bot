const { EmbedBuilder } = require('discord.js');

const { env } = require('../config/env');

const DEFAULT_TRACKED_REPO_URL = 'https://github.com/odtheking/Odin';

function createModUpdatesService({ client, store }) {
  function getAlertConfig(guildId) {
    return store.getGuildConfig(guildId).modUpdates;
  }

  function getTrackedRepoUrls(guildId) {
    const config = getAlertConfig(guildId);
    return Array.isArray(config.trackedRepos) ? config.trackedRepos : [DEFAULT_TRACKED_REPO_URL];
  }

  function parseTrackedReposInput(rawValue) {
    const values = String(rawValue || '')
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);

    return [...new Map(values.map((value) => {
      const parsed = parseGitHubRepoReference(value);
      return [parsed.fullName.toLowerCase(), parsed];
    })).values()];
  }

  async function fetchTrackedReleaseStatuses(guildId) {
    const trackedRepos = getTrackedRepoUrls(guildId).map(parseGitHubRepoReference);
    const statuses = await Promise.all(trackedRepos.map((repo) => fetchRepoReleaseStatus(repo)));
    return statuses.sort((left, right) => getStatusTimestamp(right) - getStatusTimestamp(left));
  }

  async function syncStatusMessage(guildId, statuses = null) {
    const channel = await getTargetChannel(guildId);
    const releaseStatuses = Array.isArray(statuses) ? statuses : await fetchTrackedReleaseStatuses(guildId);
    const existingMessage = await findExistingStatusMessage(guildId, channel);
    const payload = {
      content: null,
      embeds: [createReleaseStatusEmbed(releaseStatuses)]
    };

    if (existingMessage) {
      await existingMessage.edit(payload).catch(async (error) => {
        if (error?.code !== 10008) {
          throw error;
        }

        store.setGuildRuntimeState(guildId, {
          modUpdates: {
            ...store.getGuildRuntimeState(guildId).modUpdates,
            statusMessageId: null,
            statusChannelId: null
          }
        });
      });

      const refreshedState = store.getGuildRuntimeState(guildId).modUpdates;
      if (refreshedState.statusMessageId) {
        return;
      }
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      modUpdates: {
        ...store.getGuildRuntimeState(guildId).modUpdates,
        statusMessageId: sentMessage.id,
        statusChannelId: sentMessage.channelId
      }
    });
  }

  async function checkForUpdates() {
    for (const guildId of store.getModUpdateConfiguredGuildIds()) {
      try {
        const statuses = await fetchTrackedReleaseStatuses(guildId);
        const currentState = store.getGuildRuntimeState(guildId);
        const previousReleases = currentState.modUpdates.lastSeenReleases;
        const nextReleases = {};
        const updates = [];

        for (const status of statuses) {
          const currentReleaseId = getReleaseIdentifier(status);
          const hadPreviousRelease = Object.prototype.hasOwnProperty.call(previousReleases, status.fullName);
          const previousReleaseId = hadPreviousRelease ? previousReleases[status.fullName] : null;

          nextReleases[status.fullName] = status.errorMessage ? previousReleaseId : currentReleaseId;

          if (status.errorMessage || !hadPreviousRelease || previousReleaseId === currentReleaseId || !currentReleaseId) {
            continue;
          }

          updates.push(status);
        }

        store.setGuildRuntimeState(guildId, {
          modUpdates: {
            ...currentState.modUpdates,
            lastSeenReleases: nextReleases
          }
        });

        await syncStatusMessage(guildId, statuses);

        if (updates.length > 0) {
          await sendReleaseNotification(guildId, updates);
        }
      } catch (error) {
        console.error(`Mod update check failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendReleaseNotification(guildId, updates) {
    const { roleId } = getAlertConfig(guildId);

    await replaceAlertMessage(guildId, {
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createReleaseNotificationEmbed(updates)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
  }

  async function sendTestNotification(guildId) {
    const statuses = await fetchTrackedReleaseStatuses(guildId);
    const { roleId } = getAlertConfig(guildId);

    await replaceAlertMessage(guildId, {
      content: roleId ? `<@&${roleId}>` : 'Mod update test without configured ping role.',
      embeds: [createReleaseNotificationEmbed(statuses.slice(0, 3), { isTest: true })],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });
  }

  async function getTargetChannel(guildId) {
    const { channelId } = getAlertConfig(guildId);
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured mod update channel.`);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured mod update channel is not a text channel.');
    }

    return channel;
  }

  async function findExistingStatusMessage(guildId, channel) {
    const currentState = store.getGuildRuntimeState(guildId).modUpdates;

    if (currentState.statusMessageId && (!currentState.statusChannelId || currentState.statusChannelId === channel.id)) {
      const storedMessage = await channel.messages.fetch(currentState.statusMessageId).catch(() => null);
      if (storedMessage) {
        return storedMessage;
      }
    }

    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const statusMessages = recentMessages
      .filter((message) => isStatusMessage(message, client.user?.id))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    if (statusMessages.size === 0) {
      return null;
    }

    const [latestMessage, ...olderMessages] = [...statusMessages.values()];
    await Promise.all(olderMessages.map((message) => message.delete().catch(() => null)));
    store.setGuildRuntimeState(guildId, {
      modUpdates: {
        ...currentState,
        statusMessageId: latestMessage.id,
        statusChannelId: latestMessage.channelId
      }
    });
    return latestMessage;
  }

  async function replaceAlertMessage(guildId, payload) {
    const channel = await getTargetChannel(guildId);
    const existingMessages = await findExistingAlertMessages(guildId, channel);

    if (existingMessages.length > 0) {
      await Promise.all(existingMessages.map((message) => message.delete().catch(() => null)));
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      modUpdates: {
        ...store.getGuildRuntimeState(guildId).modUpdates,
        alertMessageId: sentMessage.id,
        alertChannelId: sentMessage.channelId
      }
    });
    return sentMessage;
  }

  async function findExistingAlertMessages(guildId, channel) {
    const currentState = store.getGuildRuntimeState(guildId).modUpdates;
    const messages = [];

    if (currentState.alertMessageId && (!currentState.alertChannelId || currentState.alertChannelId === channel.id)) {
      const storedMessage = await channel.messages.fetch(currentState.alertMessageId).catch(() => null);
      if (storedMessage) {
        messages.push(storedMessage);
      }
    }

    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const alertMessages = recentMessages
      .filter((message) => isAlertMessage(message, client.user?.id))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    for (const message of alertMessages.values()) {
      if (!messages.some((entry) => entry.id === message.id)) {
        messages.push(message);
      }
    }

    return messages;
  }

  async function deleteTrackedStatusMessages(guildId) {
    const currentState = store.getGuildRuntimeState(guildId).modUpdates;
    const channels = [];

    if (currentState.statusChannelId) {
      const storedChannel = await client.channels.fetch(currentState.statusChannelId).catch(() => null);
      if (storedChannel?.isTextBased()) {
        channels.push(storedChannel);
      }
    }

    const configuredChannel = await getTargetChannel(guildId).catch(() => null);
    if (configuredChannel && !channels.some((channel) => channel.id === configuredChannel.id)) {
      channels.push(configuredChannel);
    }

    await Promise.all(channels.map((channel) => deleteStatusMessagesInChannel(channel)));
    store.setGuildRuntimeState(guildId, {
      modUpdates: {
        ...currentState,
        statusMessageId: null,
        statusChannelId: null
      }
    });
  }

  async function deleteStatusMessagesInChannel(channel) {
    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const statusMessages = recentMessages.filter((message) => isStatusMessage(message, client.user?.id));

    if (statusMessages.size > 0) {
      await Promise.all([...statusMessages.values()].map((message) => message.delete().catch(() => null)));
    }
  }

  return {
    DEFAULT_TRACKED_REPO_URL,
    getAlertConfig,
    getTrackedRepoUrls,
    parseTrackedReposInput,
    fetchTrackedReleaseStatuses,
    syncStatusMessage,
    deleteTrackedStatusMessages,
    sendTestNotification,
    checkForUpdates
  };
}

async function fetchRepoReleaseStatus(repo) {
  try {
    const repoResponse = await fetchGitHub(`https://api.github.com/repos/${repo.fullName}`);

    if (!repoResponse.ok) {
      throw new Error(`GitHub repo lookup failed with status ${repoResponse.status}.`);
    }

    const repoData = await repoResponse.json();
    const releaseResponse = await fetchGitHub(`https://api.github.com/repos/${repo.fullName}/releases/latest`);

    if (releaseResponse.status === 404) {
      return {
        ...repo,
        repoUrl: repoData.html_url || repo.url,
        latestReleaseUrl: null,
        latestReleaseName: null,
        publishedAt: null,
        hasRelease: false,
        errorMessage: null
      };
    }

    if (!releaseResponse.ok) {
      throw new Error(`GitHub release lookup failed with status ${releaseResponse.status}.`);
    }

    const releaseData = await releaseResponse.json();

    return {
      ...repo,
      repoUrl: repoData.html_url || repo.url,
      latestReleaseUrl: releaseData.html_url || null,
      latestReleaseName: releaseData.name || releaseData.tag_name || 'Latest release',
      publishedAt: releaseData.published_at || releaseData.created_at || null,
      hasRelease: true,
      errorMessage: null
    };
  } catch (error) {
    return {
      ...repo,
      repoUrl: repo.url,
      latestReleaseUrl: null,
      latestReleaseName: null,
      publishedAt: null,
      hasRelease: false,
      errorMessage: error.message
    };
  }
}

function createReleaseNotificationEmbed(updates, options = {}) {
  const isTest = options.isTest === true;
  const sortedUpdates = [...updates].sort((left, right) => getStatusTimestamp(right) - getStatusTimestamp(left));
  const latestUpdate = sortedUpdates[0] || null;
  const embed = new EmbedBuilder()
    .setColor(isTest ? 0xf1c40f : 0x2ecc71)
    .setTitle(isTest ? 'Mod Update Test Ping' : 'Mod Updates Detected')
    .setDescription(isTest
      ? 'This is a test notification for the configured mod update channel and ping role.'
      : buildReleaseNotificationDescription(sortedUpdates.length, latestUpdate))
    .setTimestamp();

  for (const status of sortedUpdates.slice(0, 25)) {
    embed.addFields({
      name: status.fullName,
      value: buildReleaseFieldValue(status),
      inline: false
    });
  }

  return embed;
}

function createReleaseStatusEmbed(statuses) {
  const sortedStatuses = [...statuses].sort((left, right) => getStatusTimestamp(right) - getStatusTimestamp(left));
  const latestUpdate = sortedStatuses[0] || null;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Tracked Mod Releases')
    .setDescription(buildStatusEmbedDescription(sortedStatuses.length, latestUpdate))
    .setTimestamp();

  if (sortedStatuses.length === 0) {
    embed.addFields({
      name: 'Tracked Repositories',
      value: 'No repositories configured yet.',
      inline: false
    });
    return embed;
  }

  for (const status of sortedStatuses.slice(0, 25)) {
    embed.addFields({
      name: status.fullName,
      value: buildReleaseFieldValue(status),
      inline: false
    });
  }

  return embed;
}

function buildReleaseFieldValue(status) {
  const lines = [`GitHub: [${status.fullName}](${status.repoUrl})`];

  if (status.errorMessage) {
    lines.push(`Latest release: Could not load (${status.errorMessage})`);
    return lines.join('\n');
  }

  if (status.latestReleaseUrl) {
    lines.push(`Latest release: [${status.latestReleaseName}](${status.latestReleaseUrl})`);
  } else {
    lines.push('Latest release: No public release found');
  }

  if (status.publishedAt) {
    const unixTimestamp = Math.floor(new Date(status.publishedAt).getTime() / 1000);
    lines.push(Number.isFinite(unixTimestamp)
      ? `Released: <t:${unixTimestamp}:f> (<t:${unixTimestamp}:R>)`
      : 'Released: Unknown');
  } else {
    lines.push('Released: Unknown');
  }

  return lines.join('\n');
}

function isStatusMessage(message, clientUserId) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  return message.embeds.some((embed) => embed.title === 'Tracked Mod Releases');
}

function isAlertMessage(message, clientUserId) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  return message.embeds.some((embed) => (
    embed.title === 'Mod Updates Detected' || embed.title === 'Mod Update Test Ping'
  ));
}

function getReleaseIdentifier(status) {
  if (!status.hasRelease) {
    return null;
  }

  return status.latestReleaseUrl || status.publishedAt || status.latestReleaseName || null;
}

function buildReleaseNotificationDescription(updateCount, latestUpdate) {
  if (!latestUpdate) {
    return `${updateCount} tracked mod${updateCount === 1 ? '' : 's'} got a new release.`;
  }

  return [
    `${updateCount} tracked mod${updateCount === 1 ? '' : 's'} got a new release.`,
    `Latest updated mod: **${latestUpdate.fullName}**`
  ].join('\n');
}

function buildStatusEmbedDescription(statusCount, latestUpdate) {
  if (!latestUpdate) {
    return 'This list stays updated with the latest public GitHub release for each tracked mod.';
  }

  return [
    'This list stays updated with the latest public GitHub release for each tracked mod.',
    `Latest updated mod: **${latestUpdate.fullName}**`,
    `Tracked mods: ${statusCount}`
  ].join('\n');
}

function getStatusTimestamp(status) {
  const timestamp = Date.parse(status?.publishedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseGitHubRepoReference(value) {
  const input = String(value || '').trim();

  if (!input) {
    throw new Error('Please provide at least one GitHub repository.');
  }

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
    return createRepoDescriptor(input);
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid GitHub repository: ${input}`);
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error(`Invalid GitHub repository: ${input}`);
  }

  const segments = url.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid GitHub repository: ${input}`);
  }

  return createRepoDescriptor(`${segments[0]}/${segments[1].replace(/\.git$/, '')}`);
}

function createRepoDescriptor(fullName) {
  const [owner, repo] = fullName.split('/');

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`
  };
}

function createGitHubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Xclipsen-Bot'
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHub(url) {
  const response = await fetch(url, {
    headers: createGitHubHeaders()
  });

  // Fall back to unauthenticated requests when the configured token is invalid.
  if (response.status === 401 && env.GITHUB_TOKEN) {
    return fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Xclipsen-Bot'
      }
    });
  }

  return response;
}

module.exports = { createModUpdatesService };
