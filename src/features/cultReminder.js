const { EmbedBuilder } = require('discord.js');

const SKYBLOCK_EPOCH_SECONDS = 1560275700;
const SKYBLOCK_DAY_SECONDS = 20 * 60;
const SKYBLOCK_MONTH_SECONDS = 31 * SKYBLOCK_DAY_SECONDS;
const CULT_EVENT_DAYS = [7, 14, 21, 28];
const CULT_EVENT_DURATION_MS = 5 * 60 * 1000;

function createCultReminderService({ client, store }) {
  async function sendTestReminder(guildId) {
    await sendCultReminder(guildId, getCultSchedule(Date.now()));
  }

  async function checkForReminder() {
    const schedule = getCultSchedule();
    if (!schedule.isActive) {
      return;
    }

    for (const guildId of store.getCultReminderConfiguredGuildIds()) {
      try {
        const state = store.getGuildRuntimeState(guildId);
        if (state.cultReminder.lastSentWindowStart === schedule.windowStartAt) {
          continue;
        }

        await sendCultReminder(guildId, schedule);
        store.setGuildRuntimeState(guildId, {
          ...state,
          cultReminder: {
            ...store.getGuildRuntimeState(guildId).cultReminder,
            lastSentWindowStart: schedule.windowStartAt
          }
        });
      } catch (error) {
        console.error(`Cult reminder failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendCultReminder(guildId, schedule) {
    const cultConfig = store.getGuildConfig(guildId).cultReminder;
    const channelId = cultConfig.channelId;
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured cult reminder channel.`);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured cult reminder channel is not a text channel.');
    }

    const roleId = cultConfig.roleId;
    const payload = {
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createCultReminderEmbed(schedule)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    };

    const existingMessage = await findExistingCultReminderMessage(guildId, channel);
    if (existingMessage) {
      await existingMessage.edit(payload).catch(async (error) => {
        if (error?.code !== 10008) {
          throw error;
        }

        store.setGuildRuntimeState(guildId, {
          ...store.getGuildRuntimeState(guildId),
          cultReminder: {
            ...store.getGuildRuntimeState(guildId).cultReminder,
            messageId: null,
            channelId: null
          }
        });
      });

      const refreshedState = store.getGuildRuntimeState(guildId).cultReminder;
      if (refreshedState.messageId) {
        return;
      }
    }

    const sentMessage = await channel.send(payload);
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      cultReminder: {
        ...store.getGuildRuntimeState(guildId).cultReminder,
        messageId: sentMessage.id,
        channelId: sentMessage.channelId
      }
    });
  }

  async function findExistingCultReminderMessage(guildId, channel) {
    const currentState = store.getGuildRuntimeState(guildId).cultReminder;

    if (currentState.messageId && (!currentState.channelId || currentState.channelId === channel.id)) {
      const storedMessage = await channel.messages.fetch(currentState.messageId).catch(() => null);
      if (storedMessage) {
        return storedMessage;
      }
    }

    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const cultMessages = recentMessages
      .filter((message) => isCultReminderMessage(message, client.user?.id))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    if (cultMessages.size === 0) {
      return null;
    }

    const [latestMessage, ...olderMessages] = [...cultMessages.values()];
    await Promise.all(olderMessages.map((message) => message.delete().catch(() => null)));
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      cultReminder: {
        ...store.getGuildRuntimeState(guildId).cultReminder,
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

function getCultSchedule(now = Date.now()) {
  const monthStartAt = getCurrentMonthStartMs(now);
  const windows = CULT_EVENT_DAYS.flatMap((day) => {
    const startAt = monthStartAt + ((day - 1) * SKYBLOCK_DAY_SECONDS * 1000);
    return [{
      windowStartAt: startAt,
      windowEndAt: startAt + CULT_EVENT_DURATION_MS
    }];
  });

  const activeWindow = windows.find((window) => now >= window.windowStartAt && now < window.windowEndAt);
  const nextWindow = windows.find((window) => now < window.windowStartAt) || getFirstWindowOfNextMonth(monthStartAt);
  const activeOrNext = activeWindow || nextWindow;
  const year = getSkyBlockYear(activeOrNext.windowStartAt);
  const monthDay = getSkyBlockDay(activeOrNext.windowStartAt);

  return {
    isActive: Boolean(activeWindow),
    year,
    day: monthDay,
    windowStartAt: activeOrNext.windowStartAt,
    windowEndAt: activeOrNext.windowEndAt
  };
}

function getCurrentMonthStartMs(now) {
  const elapsedMs = now - (SKYBLOCK_EPOCH_SECONDS * 1000);
  const monthIndex = Math.floor(elapsedMs / (SKYBLOCK_MONTH_SECONDS * 1000));
  return (SKYBLOCK_EPOCH_SECONDS * 1000) + (monthIndex * SKYBLOCK_MONTH_SECONDS * 1000);
}

function getFirstWindowOfNextMonth(currentMonthStartAt) {
  const nextMonthStartAt = currentMonthStartAt + (SKYBLOCK_MONTH_SECONDS * 1000);
  const firstDay = CULT_EVENT_DAYS[0];
  const windowStartAt = nextMonthStartAt + ((firstDay - 1) * SKYBLOCK_DAY_SECONDS * 1000);

  return {
    windowStartAt,
    windowEndAt: windowStartAt + CULT_EVENT_DURATION_MS
  };
}

function getSkyBlockYear(timestampMs) {
  const elapsedSeconds = (timestampMs / 1000) - SKYBLOCK_EPOCH_SECONDS;
  return Math.floor(elapsedSeconds / (372 * SKYBLOCK_DAY_SECONDS)) + 1;
}

function getSkyBlockDay(timestampMs) {
  const elapsedSeconds = (timestampMs / 1000) - SKYBLOCK_EPOCH_SECONDS;
  return (Math.floor(elapsedSeconds / SKYBLOCK_DAY_SECONDS) % 31) + 1;
}

function createCultReminderEmbed(schedule) {
  return new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle('Cult Reminder')
    .setDescription([
      schedule.isActive
        ? `Cult of the Fallen Star is active now for **Day ${schedule.day}, Year ${schedule.year}**.`
        : `Next Cult of the Fallen Star is **Day ${schedule.day}, Year ${schedule.year}**.`,
      `Starts: <t:${Math.floor(schedule.windowStartAt / 1000)}:f> (<t:${Math.floor(schedule.windowStartAt / 1000)}:R>)`,
      `Ends: <t:${Math.floor(schedule.windowEndAt / 1000)}:f> (<t:${Math.floor(schedule.windowEndAt / 1000)}:R>)`
    ].join('\n'))
    .setTimestamp();
}

function isCultReminderMessage(message, clientUserId) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  return message.embeds.some((embed) => embed.title === 'Cult Reminder');
}

module.exports = { createCultReminderService };
