const { MessageFlags } = require('discord.js');

const { createMayorAlertData } = require('./data');
const { createMayorAlertEmbeds } = require('./embeds');

function createMayorAlerts({ client, env, store, skyblock }) {
  let lastMayorKey = null;
  let initializedMayorState = false;
  let cachedElectionData = null;
  let cachedElectionDataFetchedAt = null;
  const resolvedMayorEmojiCache = new Map();
  const warnedDisconnectedGuildIds = new Set();

  const data = createMayorAlertData({ client, env, store, skyblock, resolvedMayorEmojiCache });
  const embeds = createMayorAlertEmbeds({ env, skyblock });

  function getActiveConfiguredGuildIds(context) {
    return store.getConfiguredGuildIds()
      .filter((guildId) => {
        if (client.guilds.cache.has(guildId)) {
          return true;
        }

        if (!warnedDisconnectedGuildIds.has(guildId)) {
          console.warn(`Skipping configured guild ${guildId} during ${context}; bot is not connected to that guild.`);
          warnedDisconnectedGuildIds.add(guildId);
        }

        return false;
      });
  }

  function getMayorAlertConfig(guildId) {
    return store.getGuildConfig(guildId).mayorAlerts;
  }

  async function fetchElectionData() {
    cachedElectionData = await data.fetchElectionData();
    cachedElectionDataFetchedAt = Date.now();
    return cachedElectionData;
  }

  async function sendRolePing(guildId, content, embedsToSend = []) {
    const { roleId } = store.getGuildConfig(guildId);
    if (!roleId) {
      throw new Error(`Guild ${guildId} does not have a configured ping role.`);
    }

    await data.replaceAlertMessage(guildId, {
      content: [`<@&${roleId}>`, content].join('\n'),
      embeds: embedsToSend,
      allowedMentions: { roles: [roleId] }
    });
  }

  async function sendMayorStatusUpdate(guildId, mayor, boothOpen, currentElection = null, options = {}) {
    const channel = await data.getTargetChannel(guildId);
    const mayorEmoji = await data.getMayorEmoji(guildId, mayor);
    const payload = {
      embeds: [
        embeds.createEventCalendarEmbed(mayor),
        embeds.createMayorEmbed('SkyBlock Status Update', mayorEmoji, mayor, boothOpen, currentElection)
      ],
      components: boothOpen ? embeds.createCandidateSelectComponents(currentElection) : []
    };

    const existingMessage = await data.findExistingStatusMessage(guildId, channel);
    if (existingMessage) {
      if (options.forceResend) {
        await existingMessage.delete().catch(() => null);
        store.setGuildRuntimeState(guildId, {
          ...store.getGuildRuntimeState(guildId),
          statusMessageId: null,
          statusChannelId: null
        });
      } else {
        try {
          await existingMessage.edit({ content: null, ...payload });
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
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      statusMessageId: sentMessage.id,
      statusChannelId: sentMessage.channelId
    });
  }

  async function sendMayorChangePing(guildId, mayor, boothOpen, currentElection = null) {
    const mayorEmoji = await data.getMayorEmoji(guildId, mayor);
    const { roleId } = store.getGuildConfig(guildId);
    if (roleId && getMayorAlertConfig(guildId).pingMayorChange) {
      await sendRolePing(guildId, `${mayorEmoji} A new mayor has been elected.`);
    }
    await sendMayorStatusUpdate(guildId, mayor, boothOpen, currentElection, { forceResend: true });
  }

  async function handleCandidateSelect(interaction) {
    if (!interaction.isStringSelectMenu() || interaction.customId !== embeds.MAYOR_CANDIDATE_SELECT_ID) {
      return false;
    }

    const electionData = await fetchElectionData();
    const currentElection = electionData.current || null;
    const boothOpen = data.getBoothOpen(electionData);

    if (!boothOpen || !currentElection) {
      await interaction.reply({
        content: 'There is no open election right now.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const selectedKey = interaction.values[0];
    const candidateProfile = embeds.getCandidateProfiles(currentElection).find((profile) => profile.key === selectedKey);
    if (!candidateProfile) {
      await interaction.reply({
        content: 'That candidate is not available in the current election anymore.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const emoji = await data.getMayorEmoji(interaction.guildId, candidateProfile);
    await interaction.reply({
      embeds: [embeds.createCandidatePerkEmbed(candidateProfile, emoji)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  async function sendElectionPing(guildId, mayor, currentElection) {
    const { roleId } = store.getGuildConfig(guildId);
    if (roleId && getMayorAlertConfig(guildId).pingElectionOpen) {
      await sendRolePing(guildId, ':ballot_box: **Election Booth Open**');
    }
    await sendMayorStatusUpdate(guildId, mayor, true, currentElection, { forceResend: true });
  }

  async function checkElectionState() {
    try {
      const electionData = await fetchElectionData();
      const mayor = electionData.mayor;
      const currentElection = electionData.current || null;
      const currentMayorKey = String(mayor.key || '').toLowerCase();
      const boothOpen = data.getBoothOpen(electionData);

      if (!initializedMayorState) {
        initializedMayorState = true;
        lastMayorKey = currentMayorKey;

        for (const guildId of getActiveConfiguredGuildIds('initial mayor state check')) {
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            boothOpen
          });
        }

        console.log(`Initial mayor state set to ${mayor.name} (${currentMayorKey})`);
        return;
      }

      const mayorChanged = currentMayorKey !== lastMayorKey;

      for (const guildId of getActiveConfiguredGuildIds('election state check')) {
        try {
          const state = store.getGuildRuntimeState(guildId);
          const boothStateChanged = state.boothOpen !== boothOpen;

          if (boothStateChanged) {
            store.setGuildRuntimeState(guildId, { ...state, boothOpen });
          }

          if (boothStateChanged && boothOpen && currentElection) {
            console.log(`Election booth is now open for guild ${guildId}`);
            await sendElectionPing(guildId, mayor, currentElection);
            continue;
          }

          if (boothStateChanged && !boothOpen && mayorChanged) {
            console.log(`Election booth closed and mayor changed for guild ${guildId}`);
            await sendMayorChangePing(guildId, mayor, false, null);
            continue;
          }

          if (mayorChanged) {
            console.log(`Current mayor changed to ${mayor.name} (${currentMayorKey}) for guild ${guildId}`);
            await sendMayorChangePing(guildId, mayor, boothOpen, currentElection);
          }
        } catch (error) {
          console.error(`Election state update failed for guild ${guildId}:`, error);
        }
      }

      if (mayorChanged) {
        lastMayorKey = currentMayorKey;
        console.log(`Current mayor changed to ${mayor.name} (${currentMayorKey})`);
      }
    } catch (error) {
      console.error('Election state check failed:', error);
    }
  }

  async function sendScheduledStatusUpdate() {
    try {
      const electionData = await fetchElectionData();
      const mayor = electionData.mayor;
      const currentElection = electionData.current || null;
      const boothOpen = data.getBoothOpen(electionData);

      for (const guildId of getActiveConfiguredGuildIds('scheduled status update')) {
        try {
          await sendMayorStatusUpdate(guildId, mayor, boothOpen, currentElection);
          store.setGuildRuntimeState(guildId, { ...store.getGuildRuntimeState(guildId), boothOpen });
          console.log(`Status update sent for mayor ${mayor.name} in guild ${guildId}`);
        } catch (error) {
          console.error(`Status update failed for guild ${guildId}:`, error);
        }
      }
    } catch (error) {
      console.error('Status update failed:', error);
    }
  }

  async function refreshStatusForGuild(guildId) {
    const electionData = await fetchElectionData();
    const mayor = electionData.mayor;
    const currentElection = electionData.current || null;
    const boothOpen = data.getBoothOpen(electionData);

    await sendMayorStatusUpdate(guildId, mayor, boothOpen, currentElection);
    store.setGuildRuntimeState(guildId, { ...store.getGuildRuntimeState(guildId), boothOpen });
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
      if (error?.code === 50001 || error?.code === 10003) {
        console.warn(`Legacy Discord channel ${env.DEFAULT_DISCORD_CHANNEL_ID} is not accessible; skipping env import.`);
        return;
      }

      console.error('Could not import legacy env configuration:', error);
    }
  }

  return {
    fetchElectionData,
    getCachedElectionData: () => cachedElectionData,
    getCachedElectionDataFetchedAt: () => cachedElectionDataFetchedAt,
    getBoothOpen: data.getBoothOpen,
    handleCandidateSelect,
    sendMayorStatusUpdate,
    checkElectionState,
    sendScheduledStatusUpdate,
    refreshStatusForGuild,
    deleteTrackedMessagesForGuild: data.deleteTrackedMayorMessages,
    ensureLegacyEnvConfig
  };
}

module.exports = { createMayorAlerts };
