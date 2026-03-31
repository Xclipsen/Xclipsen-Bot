const { EmbedBuilder } = require('discord.js');

const {
  EVENT_DEFINITIONS,
  getAllEventSchedules,
  getDisplayEndAt,
  getDisplayStartAt,
  getReminderDeleteAt,
  getReminderStatusLine
} = require('./eventCalendar');

function createEventRemindersService({ client, store, minecraft = null, mayorAlerts = null }) {
  async function checkForReminders() {
    const now = Date.now();
    const schedules = getAllEventSchedules(now);

    for (const guildId of store.getEventReminderConfiguredGuildIds()) {
      try {
        const config = store.getGuildConfig(guildId).eventReminders;
        const channel = await getReminderChannel(guildId);
        let statusChanged = false;

        statusChanged = await cleanupExpiredReminderMessages(guildId, channel, now) || statusChanged;

        for (const definition of EVENT_DEFINITIONS) {
          const schedule = schedules[definition.key];
          if (!schedule?.isActive) {
            continue;
          }

          const lastSent = store.getGuildRuntimeState(guildId).eventReminders.lastSentStarts[definition.key] ?? null;
          if (lastSent === schedule.windowStartAt) {
            continue;
          }

          await sendEventReminder(guildId, channel, definition, schedule, config.roles[definition.key]);
          statusChanged = true;

          const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
          store.setGuildRuntimeState(guildId, {
            ...store.getGuildRuntimeState(guildId),
            eventReminders: {
              ...runtimeState,
              lastSentStarts: {
                ...runtimeState.lastSentStarts,
                [definition.key]: schedule.windowStartAt
              }
            }
          });
        }

        if (statusChanged) {
          await mayorAlerts?.refreshStatusForGuild?.(guildId);
        }
      } catch (error) {
        console.error(`Event reminder failed for guild ${guildId}:`, error);
      }
    }
  }

  async function sendEventReminder(guildId, channel, definition, schedule, roleId = null, options = {}) {
    const existingMessage = await findExistingEventReminderMessage(guildId, channel, definition.key);
    if (existingMessage) {
      await existingMessage.delete().catch(() => null);
    }

    const content = roleId
      ? [`<@&${roleId}>`, getReminderStatusLine(definition)].join('\n')
      : getReminderStatusLine(definition);

    const sentMessage = await channel.send({
      content,
      embeds: [createEventReminderEmbed(definition, schedule)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });

    await minecraft?.sendEventMessage?.(
      definition.key,
      definition.label,
      getReminderStatusLine(definition),
      { isTest: options.isTest === true }
    );

    const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      eventReminders: {
        ...runtimeState,
        channelId: sentMessage.channelId,
        messageIds: {
          ...runtimeState.messageIds,
          [definition.key]: sentMessage.id
        },
        messageExpireAts: {
          ...runtimeState.messageExpireAts,
          [definition.key]: getReminderDeleteAt(schedule)
        }
      }
    });
  }

  async function sendTestReminder(guildId, eventKey) {
    const definition = EVENT_DEFINITIONS.find((entry) => entry.key === eventKey);
    if (!definition) {
      throw new Error(`Unknown event reminder key: ${eventKey}`);
    }

    const config = store.getGuildConfig(guildId).eventReminders;
    const channel = await getReminderChannel(guildId);
    const schedule = {
      ...definition.getSchedule(Date.now()),
      isActive: true
    };

    await sendEventReminder(guildId, channel, definition, schedule, config.roles[definition.key], { isTest: true });
  }

  async function getReminderChannel(guildId) {
    const channelId = store.getGuildConfig(guildId).eventReminders.channelId;
    if (!channelId) {
      throw new Error(`Guild ${guildId} does not have a configured events channel.`);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured events channel is not a text channel.');
    }

    return channel;
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

    const definition = EVENT_DEFINITIONS.find((entry) => entry.key === eventKey);
    if (!definition) {
      return null;
    }

    const recentMessages = await channel.messages.fetch({ limit: 50 });
    const matchingMessages = recentMessages
      .filter((message) => isEventReminderMessage(message, client.user?.id, definition))
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

  async function cleanupExpiredReminderMessages(guildId, channel, now) {
    const runtimeState = store.getGuildRuntimeState(guildId).eventReminders;
    const nextMessageIds = { ...runtimeState.messageIds };
    const nextMessageExpireAts = { ...runtimeState.messageExpireAts };
    let changed = false;

    for (const definition of EVENT_DEFINITIONS) {
      const messageId = nextMessageIds[definition.key] || null;
      const expireAt = nextMessageExpireAts[definition.key] ?? null;
      if (!messageId || !Number.isFinite(expireAt) || now < expireAt) {
        continue;
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        await message.delete().catch(() => null);
      }

      delete nextMessageIds[definition.key];
      delete nextMessageExpireAts[definition.key];
      changed = true;
    }

    if (!changed) {
      return false;
    }

    store.setGuildRuntimeState(guildId, {
      ...store.getGuildRuntimeState(guildId),
      eventReminders: {
        ...runtimeState,
        channelId: channel.id,
        messageIds: nextMessageIds,
        messageExpireAts: nextMessageExpireAts
      }
    });

    return true;
  }

  return {
    checkForReminders,
    sendTestReminder
  };
}

function isEventReminderMessage(message, clientUserId, definition) {
  if (!message || message.author?.id !== clientUserId) {
    return false;
  }

  if (message.embeds.some((embed) => embed.title === `${definition.emoji} ${definition.label} is ACTIVE`)) {
    return true;
  }

  return typeof message.content === 'string' && message.content.includes(`${definition.label} is active now.`);
}

function createEventReminderEmbed(definition, schedule) {
  const displayStartAt = getDisplayStartAt(schedule);
  const displayEndAt = getDisplayEndAt(schedule);
  const lines = [
    `Start: <t:${Math.floor(displayStartAt / 1000)}:F>`,
    Number.isFinite(displayEndAt) ? `End: <t:${Math.floor(displayEndAt / 1000)}:F>` : null
  ].filter(Boolean);

  return new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(`${definition.emoji} ${definition.label} is ACTIVE`)
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

module.exports = { createEventRemindersService };
