const fs = require('node:fs');
const path = require('node:path');

const { EmbedBuilder } = require('discord.js');

function createMayorAlerts({ client, env, store, skyblock }) {
  let lastMayorKey = null;
  let initializedMayorState = false;
  const resolvedMayorEmojiCache = new Map();

  async function fetchElectionData() {
    const mockState = store.getMockState();

    if (mockState.enabled && mockState.scenario) {
      return loadMockElectionData(
        path.join(path.dirname(env.MOCK_DATA_FILE_PATH), 'mock-scenarios', mockState.scenario)
      );
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

  async function getStoredStatusMessage(guildId, channel) {
    return getStoredMessage(guildId, channel, 'statusMessageId', 'statusChannelId', {
      statusMessageId: null,
      statusChannelId: null
    });
  }

  async function getStoredAlertMessage(guildId, channel) {
    return getStoredMessage(guildId, channel, 'alertMessageId', 'alertChannelId', {
      alertMessageId: null,
      alertChannelId: null
    });
  }

  function isStatusUpdateMessage(message) {
    if (!message || message.author?.id !== client.user?.id) {
      return false;
    }

    if (typeof message.content === 'string' && message.content.includes('Current SkyBlock mayor update.')) {
      return true;
    }

    return message.embeds.some((embed) => embed.title?.includes('SkyBlock Status Update'));
  }

  async function findExistingStatusMessage(guildId, channel) {
    const storedMessage = await getStoredStatusMessage(guildId, channel);
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
    const existingMessage = await getStoredAlertMessage(guildId, channel);

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

  function formatMayorPerks(mayor) {
    const perks = Array.isArray(mayor.perks) ? mayor.perks : [];
    if (!perks.length) {
      return '- No perks found';
    }
    return perks
      .map((perk) => `- **${perk.name}**: ${skyblock.stripMinecraftFormatting(perk.description)}`)
      .join('\n');
  }

  function compactMayorPerks(mayor) {
    const perks = Array.isArray(mayor.perks) ? mayor.perks : [];
    if (!perks.length) {
      return 'No perks found';
    }
    return perks.map((perk) => skyblock.stripMinecraftFormatting(perk.name)).join(' | ');
  }

  function getMayorHeadUrl(mayor) {
    return env.MAYOR_HEADS[String(mayor.key || '').toLowerCase()] || null;
  }

  function getMayorSkinLink(mayor) {
    return env.MAYOR_SKIN_LINKS[String(mayor.key || '').toLowerCase()] || null;
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

  function createMayorEmbed(title, emoji, mayor, boothOpen) {
    const skyBlockDate = skyblock.formatSkyBlockDate(title === 'SkyBlock Status Update' ? env.STATUS_UPDATE_MINUTES : env.CHECK_INTERVAL_MINUTES);
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${emoji} ${title}`)
      .addFields(
        { name: 'Mayor', value: `${mayor.name} (${mayor.key})`, inline: true },
        { name: 'Election Booth', value: boothOpen ? 'Open' : 'Closed', inline: true },
        { name: boothOpen ? 'Election Ends' : 'Next Election Opens', value: skyblock.getElectionTimingLine(boothOpen), inline: false },
        { name: 'Active Perks', value: compactMayorPerks(mayor), inline: false },
        { name: 'Perk Details', value: formatMayorPerks(mayor), inline: false }
      )
      .setFooter({ text: `SkyBlock Date: ${skyBlockDate}` })
      .setTimestamp();

    if (mayor.minister) {
      embed.addFields({
        name: 'Minister',
        value: `${mayor.minister.name} - ${skyblock.stripMinecraftFormatting(mayor.minister.perk.name)}`,
        inline: false
      });
    }

    const skinLink = getMayorSkinLink(mayor);
    if (skinLink) {
      embed.addFields({ name: 'Skin', value: `[View mayor skin](${skinLink})`, inline: false });
    }

    const headUrl = getMayorHeadUrl(mayor);
    if (headUrl) {
      embed.setThumbnail(headUrl);
    }

    return embed;
  }

  async function sendRolePing(guildId, content, embeds = []) {
    const { roleId } = store.getGuildConfig(guildId);
    if (!roleId) {
      throw new Error(`Guild ${guildId} does not have a configured ping role.`);
    }

    await replaceAlertMessage(guildId, {
      content: [`<@&${roleId}>`, content].join('\n'),
      embeds,
      allowedMentions: { roles: [roleId] }
    });
  }

  async function sendMayorChangePing(guildId, mayor, boothOpen) {
    const mayorEmoji = await getMayorEmoji(guildId, mayor);
    await sendRolePing(guildId, `${mayorEmoji} A new mayor has been elected.`, [createMayorEmbed('New SkyBlock Mayor', mayorEmoji, mayor, boothOpen)]);
  }

  async function sendElectionPing(guildId, currentElection) {
    const candidateNames = Array.isArray(currentElection.candidates)
      ? currentElection.candidates.map((candidate) => candidate.name).join(', ')
      : 'Unknown candidates';

    await sendRolePing(guildId, [':ballot_box: **Election Booth Open**', `Candidates: **${candidateNames}**`, skyblock.getElectionTimingLine(true)].join('\n'));
  }

  async function sendElectionClosedPing(guildId) {
    await sendRolePing(guildId, [':lock: **Election Booth Closed**', skyblock.getElectionTimingLine(false)].join('\n'));
  }

  async function sendMayorStatusUpdate(guildId, mayor, boothOpen) {
    const channel = await getTargetChannel(guildId);
    const mayorEmoji = await getMayorEmoji(guildId, mayor);
    const payload = {
      content: `${mayorEmoji} Current SkyBlock mayor update.`,
      embeds: [createMayorEmbed('SkyBlock Status Update', mayorEmoji, mayor, boothOpen)]
    };

    const existingMessage = await findExistingStatusMessage(guildId, channel);
    if (existingMessage) {
      try {
        await existingMessage.edit(payload);
        return;
      } catch (error) {
        if (error?.code !== 10008) {
          throw error;
        }

        store.setGuildRuntimeState(guildId, {
          ...store.getGuildRuntimeState(guildId),
          statusMessageId: null,
          statusChannelId: null
        });
      }
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      statusMessageId: sentMessage.id,
      statusChannelId: sentMessage.channelId
    });
  }

  async function checkElectionState() {
    try {
      const data = await fetchElectionData();
      const mayor = data.mayor;
      const currentElection = data.current || null;
      const currentMayorKey = String(mayor.key || '').toLowerCase();
      const boothOpen = getBoothOpen(data);

      for (const guildId of store.getConfiguredGuildIds()) {
        const state = store.getGuildRuntimeState(guildId);
        if (state.boothOpen !== boothOpen) {
          store.setGuildRuntimeState(guildId, { ...state, boothOpen });

          if (boothOpen && currentElection && store.getGuildConfig(guildId).roleId) {
            console.log(`Election booth is now open for guild ${guildId}`);
            await sendElectionPing(guildId, currentElection);
          }

          if (!boothOpen && store.getGuildConfig(guildId).roleId) {
            console.log(`Election booth is now closed for guild ${guildId}`);
            await sendElectionClosedPing(guildId);
          }
        }
      }

      if (!initializedMayorState) {
        initializedMayorState = true;
        lastMayorKey = currentMayorKey;
        console.log(`Initial mayor state set to ${mayor.name} (${currentMayorKey})`);
        return;
      }

      if (currentMayorKey !== lastMayorKey) {
        lastMayorKey = currentMayorKey;
        console.log(`Current mayor changed to ${mayor.name} (${currentMayorKey})`);
        for (const guildId of store.getConfiguredGuildIds()) {
          if (store.getGuildConfig(guildId).roleId) {
            await sendMayorChangePing(guildId, mayor, boothOpen);
          }
        }
      }
    } catch (error) {
      console.error('Election state check failed:', error);
    }
  }

  async function sendScheduledStatusUpdate() {
    try {
      const data = await fetchElectionData();
      const mayor = data.mayor;
      const boothOpen = getBoothOpen(data);

      for (const guildId of store.getConfiguredGuildIds()) {
        await sendMayorStatusUpdate(guildId, mayor, boothOpen);
        store.setGuildRuntimeState(guildId, { ...store.getGuildRuntimeState(guildId), boothOpen });
        console.log(`Status update sent for mayor ${mayor.name} in guild ${guildId}`);
      }
    } catch (error) {
      console.error('Status update failed:', error);
    }
  }

  async function ensureLegacyEnvConfig() {
    if (!env.DEFAULT_DISCORD_CHANNEL_ID) {
      return;
    }

    try {
      const channel = await client.channels.fetch(env.DEFAULT_DISCORD_CHANNEL_ID);
      if (!channel || !('guildId' in channel) || !channel.guildId) {
        return;
      }

      const existingConfig = store.getGuildConfig(channel.guildId);
      store.setGuildConfig(channel.guildId, {
        channelId: existingConfig.channelId || env.DEFAULT_DISCORD_CHANNEL_ID,
        roleId: existingConfig.roleId || env.DEFAULT_DISCORD_ROLE_ID
      });
    } catch (error) {
      console.error('Could not import legacy env configuration:', error);
    }
  }

  return {
    fetchElectionData,
    getBoothOpen,
    sendMayorStatusUpdate,
    checkElectionState,
    sendScheduledStatusUpdate,
    ensureLegacyEnvConfig
  };
}

module.exports = { createMayorAlerts };
