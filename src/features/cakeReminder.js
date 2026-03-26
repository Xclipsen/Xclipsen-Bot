const { EmbedBuilder } = require('discord.js');

const SKYBLOCK_EPOCH_SECONDS = 1560275700;
const SKYBLOCK_DAY_SECONDS = 20 * 60;
const SKYBLOCK_YEAR_SECONDS = 372 * SKYBLOCK_DAY_SECONDS;
const CAKE_EVENT_START_DAY_OF_YEAR = (11 * 31) + 28;
const CAKE_EVENT_DURATION_DAYS = 3;

function createCakeReminderService({ client, store }) {
  async function sendTestReminder(guildId) {
    await sendCakeReminder(guildId, getCakeSchedule(Date.now()));
  }

  async function checkForReminder() {
    const schedule = getCakeSchedule();
    if (!schedule.isActive) {
      return;
    }

    for (const guildId of store.getCakeReminderConfiguredGuildIds()) {
      try {
        const state = store.getGuildRuntimeState(guildId);
        const lastSentWindowStart = state.cakeReminder.lastSentWindowStart;

        if (lastSentWindowStart === schedule.windowStartAt) {
          continue;
        }

        await sendCakeReminder(guildId, schedule);
        store.setGuildRuntimeState(guildId, {
          ...state,
          cakeReminder: {
            ...store.getGuildRuntimeState(guildId).cakeReminder,
            lastSentWindowStart: schedule.windowStartAt
          }
        });
      } catch (error) {
        console.error(`Cake reminder failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendCakeReminder(guildId, schedule) {
    const cakeConfig = store.getGuildConfig(guildId).cakeReminder;
    const channelId = cakeConfig.channelId;
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured cake reminder channel.`);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured cake reminder channel is not a text channel.');
    }

    const roleId = cakeConfig.roleId;
    const payload = {
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createCakeReminderEmbed(schedule)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    };

    const existingMessage = await findExistingCakeReminderMessage(guildId, channel);
    if (existingMessage) {
      await existingMessage.edit(payload).catch(async (error) => {
        if (error?.code !== 10008) {
          throw error;
        }

        store.setGuildRuntimeState(guildId, {
          ...store.getGuildRuntimeState(guildId),
          cakeReminder: {
            ...store.getGuildRuntimeState(guildId).cakeReminder,
            messageId: null,
            channelId: null
          }
        });
      });

      const refreshedState = store.getGuildRuntimeState(guildId).cakeReminder;
      if (refreshedState.messageId) {
        return;
      }
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      cakeReminder: {
        ...store.getGuildRuntimeState(guildId).cakeReminder,
        messageId: sentMessage.id,
        channelId: sentMessage.channelId
      }
    });
  }

  async function findExistingCakeReminderMessage(guildId, channel) {
    const currentState = store.getGuildRuntimeState(guildId).cakeReminder;

    if (currentState.messageId && (!currentState.channelId || currentState.channelId === channel.id)) {
      const storedMessage = await channel.messages.fetch(currentState.messageId).catch(() => null);
      if (storedMessage) {
        return storedMessage;
      }
    }

    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const cakeMessages = recentMessages
      .filter((message) => isCakeReminderMessage(message, client.user?.id))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    if (cakeMessages.size === 0) {
      return null;
    }

    const [latestMessage, ...olderMessages] = [...cakeMessages.values()];
    await Promise.all(olderMessages.map((message) => message.delete().catch(() => null)));
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      cakeReminder: {
        ...store.getGuildRuntimeState(guildId).cakeReminder,
        messageId: latestMessage.id,
        channelId: latestMessage.channelId
      }
    });
    return latestMessage;
  }

  return {
    checkForReminder,
    sendTestReminder
  };
}

function getCakeSchedule(now = Date.now()) {
  const nowSeconds = now / 1000;
  const elapsedSeconds = nowSeconds - SKYBLOCK_EPOCH_SECONDS;
  const currentYear = Math.floor(elapsedSeconds / SKYBLOCK_YEAR_SECONDS) + 1;

  const currentWindowStartAt = getCakeWindowStartMs(currentYear);
  const currentWindowEndAt = currentWindowStartAt + (CAKE_EVENT_DURATION_DAYS * SKYBLOCK_DAY_SECONDS * 1000);
  const isActive = now >= currentWindowStartAt && now < currentWindowEndAt;
  const nextYear = now < currentWindowStartAt ? currentYear : currentYear + 1;

  return {
    isActive,
    year: currentYear,
    windowStartAt: currentWindowStartAt,
    windowEndAt: currentWindowEndAt,
    nextWindowStartAt: getCakeWindowStartMs(nextYear),
    nextWindowEndAt: getCakeWindowEndMs(nextYear)
  };
}

function getCakeWindowStartMs(year) {
  return (
    SKYBLOCK_EPOCH_SECONDS +
    ((year - 1) * SKYBLOCK_YEAR_SECONDS) +
    (CAKE_EVENT_START_DAY_OF_YEAR * SKYBLOCK_DAY_SECONDS)
  ) * 1000;
}

function getCakeWindowEndMs(year) {
  return getCakeWindowStartMs(year) + (CAKE_EVENT_DURATION_DAYS * SKYBLOCK_DAY_SECONDS * 1000);
}

function createCakeReminderEmbed(schedule) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('Cake Reminder')
    .setDescription([
      schedule.isActive
        ? `Cake is active now for **Year ${schedule.year}**.`
        : `Next cake is **Year ${schedule.year}**.`,
      `Starts: <t:${Math.floor(schedule.windowStartAt / 1000)}:f> (<t:${Math.floor(schedule.windowStartAt / 1000)}:R>)`,
      `Ends: <t:${Math.floor(schedule.windowEndAt / 1000)}:f> (<t:${Math.floor(schedule.windowEndAt / 1000)}:R>)`
    ].join('\n'))
    .setTimestamp();
}

function isCakeReminderMessage(message, clientUserId) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  return message.embeds.some((embed) => embed.title === 'Cake Reminder');
}

module.exports = { createCakeReminderService };
