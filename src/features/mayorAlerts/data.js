const fs = require('node:fs');

function createMayorAlertData({ client, env, store, skyblock, resolvedMayorEmojiCache }) {
  async function fetchElectionData() {
    const mockState = store.getMockState();

    if (mockState.enabled && mockState.customData) {
      return mockState.customData;
    }

    if (env.MOCK_MODE) {
      return loadMockElectionData(env.MOCK_DATA_FILE_PATH);
    }

    const response = await fetch(env.ELECTION_URL, {
      headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' }
    });

    if (!response.ok) {
      throw new Error(`Hypixel API responded with ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success || !data.mayor) {
      throw new Error('Hypixel API response did not contain mayor data.');
    }

    return data;
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
    const { channelId } = store.getGuildConfig(guildId);
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

    return message.embeds.some((embed) => embed.title?.includes('SkyBlock Status Update'));
  }

  function isAlertMessage(message) {
    if (!message || message.author?.id !== client.user?.id) {
      return false;
    }

    if (typeof message.content === 'string') {
      return [
        'A new mayor has been elected.',
        'Election Booth Open',
        '<@&'
      ].some((fragment) => message.content.includes(fragment));
    }

    return false;
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

  async function deleteTrackedMayorMessages(guildId) {
    const channel = await getTargetChannel(guildId);
    const recentMessages = await channel.messages.fetch({ limit: 50 });
    const messagesToDelete = recentMessages.filter((message) => isStatusUpdateMessage(message) || isAlertMessage(message));

    if (messagesToDelete.size > 0) {
      await Promise.all([...messagesToDelete.values()].map((message) => message.delete().catch(() => null)));
    }

    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      statusMessageId: null,
      statusChannelId: null,
      alertMessageId: null,
      alertChannelId: null
    });
  }

  async function getMayorEmoji(guildId, mayor) {
    const mayorKey = String(mayor.key || '').toLowerCase();
    const mayorName = String(mayor.name || '').toLowerCase();
    const lookupKeys = [mayorName, mayorKey].filter(Boolean);

    for (const lookupKey of lookupKeys) {
      const cacheKey = `${guildId}:${lookupKey}`;
      if (resolvedMayorEmojiCache.has(cacheKey)) {
        return resolvedMayorEmojiCache.get(cacheKey);
      }
    }

    const configuredEmoji = env.MAYOR_EMOJIS[mayorName] || env.MAYOR_EMOJIS[mayorKey];
    if (configuredEmoji && configuredEmoji.startsWith('<')) {
      for (const lookupKey of lookupKeys) {
        resolvedMayorEmojiCache.set(`${guildId}:${lookupKey}`, configuredEmoji);
      }
      return configuredEmoji;
    }

    try {
      const channel = await getTargetChannel(guildId);
      if ('guild' in channel && channel.guild) {
        await channel.guild.emojis.fetch();
        const matchingEmoji = channel.guild.emojis.cache.find((emoji) => {
          const normalizedName = String(emoji.name || '').toLowerCase();
          return lookupKeys.some((lookupKey) => (
            normalizedName === lookupKey ||
            normalizedName === `mayor_${lookupKey}` ||
            normalizedName === `mayor${lookupKey}`
          ));
        });

        if (matchingEmoji) {
          const formattedEmoji = matchingEmoji.toString();
          for (const lookupKey of lookupKeys) {
            resolvedMayorEmojiCache.set(`${guildId}:${lookupKey}`, formattedEmoji);
          }
          return formattedEmoji;
        }

        console.log(`No custom emoji found for ${lookupKeys.join(', ')}; checked ${channel.guild.emojis.cache.size} guild emojis`);
      }
    } catch (error) {
      console.error(`Could not resolve custom emoji for ${lookupKeys.join(', ')}:`, error);
    }

    return configuredEmoji || '👤';
  }

  return {
    fetchElectionData,
    getBoothOpen,
    getTargetChannel,
    findExistingStatusMessage,
    replaceAlertMessage,
    deleteTrackedMayorMessages,
    getMayorEmoji
  };
}

module.exports = { createMayorAlertData };
