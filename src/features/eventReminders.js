const { EmbedBuilder } = require('discord.js');

const SKYBLOCK_EPOCH_SECONDS = 1560275700;
const SKYBLOCK_DAY_SECONDS = 20 * 60;
const SKYBLOCK_MONTH_SECONDS = 31 * SKYBLOCK_DAY_SECONDS;
const SKYBLOCK_YEAR_SECONDS = 372 * SKYBLOCK_DAY_SECONDS;
const MONTH_LENGTH_DAYS = 31;

const EVENT_DEFINITIONS = [
  {
    key: 'cakeReminder',
    label: 'Cake Reminder',
    color: 0xf39c12,
    getSchedule: (now) => getYearlyEventSchedule(now, 11, 29, 3)
  },
  {
    key: 'cultReminder',
    label: 'Cult Reminder',
    color: 0x8e44ad,
    getSchedule: (now) => getMonthlyCultSchedule(now)
  },
  {
    key: 'spookyFestival',
    label: 'Spooky Festival',
    color: 0xe67e22,
    getSchedule: (now) => getYearlyEventSchedule(now, 7, 29, 3)
  },
  {
    key: 'travelingZoo',
    label: 'Traveling Zoo',
    color: 0x2ecc71,
    getSchedule: (now) => getMultiWindowSchedule(now, [
      { monthIndex: 3, day: 1, durationDays: 3 },
      { monthIndex: 9, day: 1, durationDays: 3 }
    ]),
    extraLines: (schedule) => buildTravelingZooLines(schedule)
  },
  {
    key: 'hoppitysHunt',
    label: "Hoppity's Hunt",
    color: 0xff69b4,
    getSchedule: (now) => getYearlyEventSchedule(now, 0, 1, 93)
  },
  {
    key: 'seasonOfJerry',
    label: 'Season of Jerry',
    color: 0x5dade2,
    getSchedule: (now) => getYearlyEventSchedule(now, 11, 24, 3)
  }
];

function createEventRemindersService({ client, store }) {
  async function checkForReminders() {
    const schedules = Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [definition.key, definition.getSchedule(Date.now())]));

    for (const guildId of store.getEventReminderConfiguredGuildIds()) {
      try {
        const config = store.getGuildConfig(guildId).eventReminders;
        const state = store.getGuildRuntimeState(guildId).eventReminders;

        for (const definition of EVENT_DEFINITIONS) {
          const schedule = schedules[definition.key];
          if (!schedule.isActive) {
            continue;
          }

          const lastSent = state.lastSentStarts[definition.key] ?? null;
          if (lastSent === schedule.windowStartAt) {
            continue;
          }

          await sendEventReminder(guildId, definition, schedule, config.roles[definition.key]);
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            eventReminders: {
              lastSentStarts: {
                ...store.getGuildRuntimeState(guildId).eventReminders.lastSentStarts,
                [definition.key]: schedule.windowStartAt
              }
            }
          });
        }
      } catch (error) {
        console.error(`Event reminder failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendEventReminder(guildId, definition, schedule, roleId = null) {
    const channelId = store.getGuildConfig(guildId).eventReminders.channelId;
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured events channel.`);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured events channel is not a text channel.');
    }

    const payload = {
      content: roleId ? `<@&${roleId}>` : null,
      embeds: [createEventReminderEmbed(definition, schedule)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    };

    const existingMessage = await findExistingEventReminderMessage(guildId, channel, definition.key);
    if (existingMessage) {
      await existingMessage.edit(payload).catch(async (error) => {
        if (error?.code !== 10008) {
          throw error;
        }

        const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
        store.setGuildRuntimeState(guildId, {
          ...store.getGuildRuntimeState(guildId),
          eventReminders: {
            ...runtimeState,
            messageIds: {
              ...runtimeState.messageIds,
              [definition.key]: null
            }
          }
        });
      });

      const refreshedState = store.getGuildRuntimeState(guildId).eventReminders;
      if (refreshedState.messageIds[definition.key]) {
        return;
      }
    }

    const sentMessage = await channel.send(payload);
    const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      eventReminders: {
        ...runtimeState,
        channelId: sentMessage.channelId,
        messageIds: {
          ...runtimeState.messageIds,
          [definition.key]: sentMessage.id
        }
      }
    });
  }

  async function sendTestReminders(guildId) {
    const config = store.getGuildConfig(guildId).eventReminders;

    for (const definition of EVENT_DEFINITIONS) {
      const schedule = definition.getSchedule(Date.now());
      await sendEventReminder(guildId, definition, schedule, config.roles[definition.key]);
    }
  }

  async function findExistingEventReminderMessage(guildId, channel, eventKey) {
    const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
    const storedMessageId = runtimeState.messageIds[eventKey] || null;

    if (storedMessageId && (!runtimeState.channelId || runtimeState.channelId === channel.id)) {
      const storedMessage = await channel.messages.fetch(storedMessageId).catch(() => null);
      if (storedMessage) {
        return storedMessage;
      }
    }

    const recentMessages = await channel.messages.fetch({ limit: 50 });
    const matchingMessages = recentMessages
      .filter((message) => isEventReminderMessage(message, client.user?.id, eventKey))
      .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

    if (matchingMessages.size === 0) {
      return null;
    }

    const [latestMessage, ...olderMessages] = [...matchingMessages.values()];
    await Promise.all(olderMessages.map((message) => message.delete().catch(() => null)));

    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      eventReminders: {
        ...runtimeState,
        channelId: latestMessage.channelId,
        messageIds: {
          ...runtimeState.messageIds,
          [eventKey]: latestMessage.id
        }
      }
    });

    return latestMessage;
  }

  return {
    checkForReminders,
    sendTestReminders
  };
}

function createEventReminderEmbed(definition, schedule) {
  const extraLines = typeof definition.extraLines === 'function' ? definition.extraLines(schedule) : [];

  return new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(definition.label)
    .setDescription([
      schedule.isActive
        ? `${definition.label} is active now.`
        : `Next ${definition.label} starts soon.`,
      `Starts: <t:${Math.floor(schedule.windowStartAt / 1000)}:f> (<t:${Math.floor(schedule.windowStartAt / 1000)}:R>)`,
      `Ends: <t:${Math.floor(schedule.windowEndAt / 1000)}:f> (<t:${Math.floor(schedule.windowEndAt / 1000)}:R>)`,
      ...extraLines
    ].join('\n'))
    .setTimestamp();
}

function isEventReminderMessage(message, clientUserId, eventKey) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  const definition = EVENT_DEFINITIONS.find((entry) => entry.key === eventKey);
  return Boolean(definition) && message.embeds.some((embed) => embed.title === definition.label);
}

function getYearlyEventSchedule(now, monthIndex, day, durationDays) {
  const year = getSkyBlockYear(now);
  const currentStart = getSkyBlockTimestampMs(year, monthIndex, day);
  const currentEnd = currentStart + (durationDays * SKYBLOCK_DAY_SECONDS * 1000);

  if (now < currentStart) {
    return {
      isActive: false,
      windowStartAt: currentStart,
      windowEndAt: currentEnd
    };
  }

  if (now < currentEnd) {
    return {
      isActive: true,
      windowStartAt: currentStart,
      windowEndAt: currentEnd
    };
  }

  const nextStart = getSkyBlockTimestampMs(year + 1, monthIndex, day);
  return {
    isActive: false,
    windowStartAt: nextStart,
    windowEndAt: nextStart + (durationDays * SKYBLOCK_DAY_SECONDS * 1000)
  };
}

function getMonthlyCultSchedule(now) {
  const monthStartAt = getCurrentMonthStartMs(now);
  const cultWindows = [7, 14, 21, 28].map((day) => {
    const windowStartAt = monthStartAt + ((day - 1) * SKYBLOCK_DAY_SECONDS * 1000);
    return {
      windowStartAt,
      windowEndAt: windowStartAt + (3 * SKYBLOCK_DAY_SECONDS * 1000)
    };
  });

  const nextMonthStartAt = monthStartAt + (MONTH_LENGTH_DAYS * SKYBLOCK_DAY_SECONDS * 1000);
  cultWindows.push({
    windowStartAt: nextMonthStartAt + (6 * SKYBLOCK_DAY_SECONDS * 1000),
    windowEndAt: nextMonthStartAt + (9 * SKYBLOCK_DAY_SECONDS * 1000)
  });

  const activeWindow = cultWindows.find((window) => now >= window.windowStartAt && now < window.windowEndAt);
  if (activeWindow) {
    return { ...activeWindow, isActive: true };
  }

  const nextWindow = cultWindows.find((window) => now < window.windowStartAt);
  return { ...nextWindow, isActive: false };
}

function getMultiWindowSchedule(now, windows) {
  const year = getSkyBlockYear(now);
  const candidates = [
    ...windows.map((window) => createWindow(year, window)),
    ...windows.map((window) => createWindow(year + 1, window))
  ].sort((left, right) => left.windowStartAt - right.windowStartAt);

  const activeWindow = candidates.find((window) => now >= window.windowStartAt && now < window.windowEndAt);
  if (activeWindow) {
    return { ...activeWindow, isActive: true };
  }

  const nextWindow = candidates.find((window) => now < window.windowStartAt);
  return { ...nextWindow, isActive: false };
}

function createWindow(year, window) {
  const windowStartAt = getSkyBlockTimestampMs(year, window.monthIndex, window.day);
  return {
    windowStartAt,
    windowEndAt: windowStartAt + (window.durationDays * SKYBLOCK_DAY_SECONDS * 1000)
  };
}

function getCurrentMonthStartMs(now) {
  const elapsedMs = now - (SKYBLOCK_EPOCH_SECONDS * 1000);
  const monthIndex = Math.floor(elapsedMs / (SKYBLOCK_MONTH_SECONDS * 1000));
  return (SKYBLOCK_EPOCH_SECONDS * 1000) + (monthIndex * SKYBLOCK_MONTH_SECONDS * 1000);
}

function getSkyBlockYear(nowMs) {
  const elapsedSeconds = (nowMs / 1000) - SKYBLOCK_EPOCH_SECONDS;
  return Math.floor(elapsedSeconds / SKYBLOCK_YEAR_SECONDS) + 1;
}

function getSkyBlockTimestampMs(year, monthIndex, day) {
  const dayOfYear = (monthIndex * MONTH_LENGTH_DAYS) + (day - 1);
  return (
    SKYBLOCK_EPOCH_SECONDS +
    ((year - 1) * SKYBLOCK_YEAR_SECONDS) +
    (dayOfYear * SKYBLOCK_DAY_SECONDS)
  ) * 1000;
}

function getSkyBlockMonthIndex(nowMs) {
  const elapsedSeconds = (nowMs / 1000) - SKYBLOCK_EPOCH_SECONDS;
  return Math.floor(elapsedSeconds / SKYBLOCK_MONTH_SECONDS) % 12;
}

function buildTravelingZooLines(schedule) {
  const guaranteedPet = getTravelingZooLegendaryPet(schedule.windowStartAt);

  return [
    `Guaranteed LEGENDARY pet: **${guaranteedPet}**`,
    'The other 2 pets are random and cannot be predicted reliably.'
  ];
}

function getTravelingZooLegendaryPet(windowStartAt) {
  const cycle = ['Blue Whale', 'Tiger', 'Lion', 'Monkey', 'Elephant', 'Giraffe'];
  const year = getSkyBlockYear(windowStartAt);
  const monthIndex = getSkyBlockMonthIndex(windowStartAt);
  const seasonIndex = monthIndex === 3 ? 0 : 1;
  const cycleIndex = ((2 * (year - 1)) + seasonIndex + 4) % cycle.length;
  return cycle[cycleIndex];
}

module.exports = { createEventRemindersService };
