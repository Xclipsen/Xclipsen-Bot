const fs = require('node:fs');

const { STATUS_UPDATE_TITLE, getMayorAppEmoji, getMayorLookupKeys, getMayorUnicodeEmoji } = require('./embeds');
const { createHypixelApi } = require('../../utils/hypixelApi');
const { NO_APP_EMOJIS } = require('../../utils/appEmojis');

// Text of the mayor role pings (see ./index.js); event reminders share the channel and must never match.
const MAYOR_ALERT_TEXTS = ['A new mayor has been elected.', 'Election Booth Open'];

function createMayorAlertData({ client, env, store, skyblock, resolvedMayorEmojiCache, hypixelApi = createHypixelApi({ env }), appEmojis = NO_APP_EMOJIS }) {
  const loggedMissingEmojiKeys = new Set();

  async function fetchElectionData() {
    const mockState = store.getMockState();

    if (mockState.enabled && mockState.customData) {
      return mockState.customData;
    }

    if (env.MOCK_MODE) {
      return loadMockElectionData(env.MOCK_DATA_FILE_PATH);
    }

    // Always fresh for the mayor checks; the response also refreshes the cache other features read.
    return hypixelApi.getElection({ maxAgeMs: 0 });
  }

  function loadMockElectionData(filePath) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data.success || !data.mayor) {
        throw new Error();
      }
      return data;
    } catch {
      throw new Error(`Mock election data is invalid: ${filePath}`);
    }
  }

  function getBoothOpen(data) {
    if (typeof data?._mock?.boothOpen === 'boolean') {
      return data._mock.boothOpen;
    }

    return skyblock.getElectionSchedule().boothOpen;
  }

  async function getTargetChannel(guildId) {
    const guildConfig = store.getGuildConfig(guildId);
    const channelId = guildConfig.eventReminders.channelId || guildConfig.channelId;
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured target channel.`);
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured Discord channel is not a text channel.');
    }

    return channel;
  }

  async function getStoredMessage(guildId, channel, idKey, channelKey, resetState) {
    const state = store.getGuildRuntimeState(guildId);
    if (!state[idKey]) {
      return null;
    }

    if (state[channelKey] && state[channelKey] !== channel.id) {
      return null;
    }

    try {
      return await channel.messages.fetch(state[idKey]);
    } catch {
      store.setGuildRuntimeState(guildId, resetState);
      return null;
    }
  }

  function isStatusUpdateMessage(message) {
    if (!message || message.author?.id !== client.user?.id) {
      return false;
    }

    return message.embeds.some((embed) => (
      embed.title === 'Event Calendar' ||
      embed.title?.includes(STATUS_UPDATE_TITLE)
    ));
  }

  function isAlertMessage(message) {
    if (!message || message.author?.id !== client.user?.id || typeof message.content !== 'string') {
      return false;
    }

    return MAYOR_ALERT_TEXTS.some((text) => message.content.includes(text));
  }

  async function findExistingStatusMessage(guildId, channel) {
    const storedMessage = await getStoredMessage(guildId, channel, 'statusMessageId', 'statusChannelId', {
      statusMessageId: null,
      statusChannelId: null
    });
    if (storedMessage) {
      return storedMessage;
    }

    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const statusMessages = recentMessages
      .filter((message) => isStatusUpdateMessage(message))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    if (statusMessages.size === 0) {
      return null;
    }

    const [latestMessage, ...olderMessages] = [...statusMessages.values()];
    await Promise.all(olderMessages.map((message) => message.delete().catch(() => null)));
    store.setGuildRuntimeState(guildId, {
      statusMessageId: latestMessage.id,
      statusChannelId: latestMessage.channelId
    });
    return latestMessage;
  }

  async function replaceAlertMessage(guildId, payload) {
    const channel = await getTargetChannel(guildId);
    const existingMessage = await getStoredMessage(guildId, channel, 'alertMessageId', 'alertChannelId', {
      alertMessageId: null,
      alertChannelId: null
    });

    if (existingMessage) {
      await existingMessage.delete().catch(() => null);
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      alertMessageId: sentMessage.id,
      alertChannelId: sentMessage.channelId
    });
    return sentMessage;
  }

  // Removes the status post and the latest mayor ping, plus untracked leftovers of both among the
  // recent messages; event reminder pings in the same channel stay.
  async function deleteTrackedMayorMessages(guildId) {
    const channel = await getTargetChannel(guildId);
    for (const [idKey, channelKey] of [['statusMessageId', 'statusChannelId'], ['alertMessageId', 'alertChannelId']]) {
      const message = await getStoredMessage(guildId, channel, idKey, channelKey, { [idKey]: null, [channelKey]: null });
      await message?.delete().catch(() => null);
    }

    const recentMessages = await channel.messages.fetch({ limit: 50 });
    const messagesToDelete = recentMessages.filter((message) => isStatusUpdateMessage(message) || isAlertMessage(message));

    if (messagesToDelete.size > 0) {
      await Promise.all([...messagesToDelete.values()].map((message) => message.delete().catch(() => null)));
    }

    store.setGuildRuntimeState(guildId, {
      statusMessageId: null,
      statusChannelId: null,
      alertMessageId: null,
      alertChannelId: null
    });
  }

  async function loadGuildEmojis(guildId) {
    try {
      const channel = await getTargetChannel(guildId);
      if (!('guild' in channel) || !channel.guild) {
        return null;
      }

      await channel.guild.emojis.fetch();
      return channel.guild.emojis.cache;
    } catch (error) {
      console.error(`Could not load the custom emojis of guild ${guildId}:`, error);
      return null;
    }
  }

  // A configured custom emoji (EMOJI_<MAYOR>) or a guild emoji named like the mayor wins and is
  // cached; otherwise the head application emoji, which can still appear after a late upload.
  function findCustomMayorEmoji(guildId, mayor, guildEmojis) {
    const lookupKeys = getMayorLookupKeys(mayor);
    if (lookupKeys.length === 0) {
      return null;
    }

    for (const lookupKey of lookupKeys) {
      const cacheKey = `${guildId}:${lookupKey}`;
      if (resolvedMayorEmojiCache.has(cacheKey)) {
        return resolvedMayorEmojiCache.get(cacheKey);
      }
    }

    const configuredEmoji = lookupKeys.map((lookupKey) => env.MAYOR_EMOJIS[lookupKey]).find(Boolean);
    const matchingEmoji = configuredEmoji && configuredEmoji.startsWith('<')
      ? configuredEmoji
      : guildEmojis?.find((emoji) => {
        const normalizedName = String(emoji.name || '').toLowerCase();
        return lookupKeys.some((lookupKey) => (
          normalizedName === lookupKey ||
          normalizedName === `mayor_${lookupKey}` ||
          normalizedName === `mayor${lookupKey}`
        ));
      })?.toString();

    if (matchingEmoji) {
      for (const lookupKey of lookupKeys) {
        resolvedMayorEmojiCache.set(`${guildId}:${lookupKey}`, matchingEmoji);
      }
      return matchingEmoji;
    }

    return getMayorAppEmoji(appEmojis, mayor);
  }

  // Sync lookup of custom mayor emojis for one status post: guild emoji → head application emoji → ''.
  async function getMayorIconResolver(guildId) {
    const guildEmojis = await loadGuildEmojis(guildId);
    const mayorIcon = (mayor) => findCustomMayorEmoji(guildId, mayor, guildEmojis) || '';
    mayorIcon.guildEmojiCount = guildEmojis?.size ?? 0;
    return mayorIcon;
  }

  // The mayor's emoji for message content: custom (see above) or the configured Unicode emoji.
  async function getMayorEmoji(guildId, mayor, mayorIcon = null) {
    const lookupKeys = getMayorLookupKeys(mayor);
    const cachedKey = lookupKeys.find((lookupKey) => resolvedMayorEmojiCache.has(`${guildId}:${lookupKey}`));
    if (cachedKey) {
      return resolvedMayorEmojiCache.get(`${guildId}:${cachedKey}`);
    }

    const resolver = mayorIcon || await getMayorIconResolver(guildId);
    const customEmoji = resolver(mayor);
    if (customEmoji) {
      return customEmoji;
    }

    // Checked on every status update, so a missing emoji is only reported once per guild and mayor.
    const missingKey = `${guildId}:${lookupKeys.join(',')}`;
    if (!loggedMissingEmojiKeys.has(missingKey)) {
      loggedMissingEmojiKeys.add(missingKey);
      console.log(`No custom emoji found for ${lookupKeys.join(', ')}; checked ${resolver.guildEmojiCount ?? 0} guild emojis and the application emojis`);
    }

    return getMayorUnicodeEmoji(env, mayor);
  }

  return {
    fetchElectionData,
    getBoothOpen,
    getTargetChannel,
    findExistingStatusMessage,
    replaceAlertMessage,
    deleteTrackedMayorMessages,
    getMayorEmoji,
    getMayorIconResolver
  };
}

module.exports = { createMayorAlertData };
