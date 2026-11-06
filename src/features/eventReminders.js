const { EmbedBuilder } = require('discord.js');

const {
  EVENT_DEFINITIONS,
  getAllEventSchedules,
  getDisplayEndAt,
  getDisplayStartAt,
  getReminderDeleteAt,
  getReminderStatusLine,
  formatScheduleDuration
} = require('./eventCalendar');
const { refreshJerryRotationSafely } = require('./jerryRotation');
const { NO_APP_EMOJIS } = require('../utils/appEmojis');

// Feast reminders show the crop rotation of the matching (regular or Grand) feast.
function matchFeast(definition, feast) {
  return definition.feast && feast?.available && feast.grand === definition.feast.grand ? feast : null;
}

// appEmojis: item icons in the Discord ping text and as embed thumbnail. Embed titles keep the Unicode
// emoji (they do not render custom emojis, and older reminders are found by title), and the Minecraft
// bridge always gets plain text.
function createEventRemindersService({ client, store, minecraft = null, mayorAlerts = null, jerryRotation = null, feastProvider = null, nowFn = Date.now, scheduleProvider = getAllEventSchedules, appEmojis = NO_APP_EMOJIS }) {
  function updateReminderState(guildId, patch) {
    store.updateGuildRuntimeSection(guildId, 'eventReminders', patch);
  }

  async function loadElectionDataForSchedules({ logErrors = true } = {}) {
    const cachedElectionData = mayorAlerts?.getCachedElectionData?.();
    if (cachedElectionData) {
      return cachedElectionData;
    }

    if (typeof mayorAlerts?.fetchElectionData !== 'function') {
      return null;
    }

    try {
      return await mayorAlerts.fetchElectionData();
    } catch (error) {
      if (logErrors) {
        console.error('Could not load mayor data for event reminders:', error);
      }
      return null;
    }
  }

  function getScheduleContext(electionData) {
    return {
      mayor: electionData?.mayor || null,
      mayorFetchedAt: mayorAlerts?.getCachedElectionDataFetchedAt?.() ?? null,
      jerryRotation
    };
  }

  async function checkForReminders() {
    const now = nowFn();
    const electionData = await loadElectionDataForSchedules();
    await refreshJerryRotationSafely(jerryRotation, electionData);
    const schedules = scheduleProvider(now, getScheduleContext(electionData));

    const feastIsActive = EVENT_DEFINITIONS.some((definition) => definition.feast && schedules[definition.key]?.isActive);
    const feast = feastIsActive ? await feastProvider?.getCurrent().catch(() => null) : null;

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

          const reminderState = store.getGuildRuntimeState(guildId).eventReminders;
          const lastSent = reminderState.lastSentStarts[definition.key] ?? null;
          const currentFeast = matchFeast(definition, feast);
          const previous = reminderState.feastRotations?.[definition.key];
          const signature = currentFeast ? [...currentFeast.crops].sort().join('|') : null;
          const rememberCrops = () => {
            if (!signature) return;
            updateReminderState(guildId, (latest) => ({ feastRotations: { ...latest.feastRotations, [definition.key]: { signature, windowStartAt: schedule.windowStartAt } } }));
          };
          if (lastSent === schedule.windowStartAt) {
            if (!signature) continue;
            if (!previous || previous.windowStartAt !== schedule.windowStartAt) {
              // Upgrade existing reminders with crop data without pinging the role again.
              const existing = await findExistingEventReminderMessage(guildId, channel, definition.key);
              if (existing) await existing.edit({ embeds: [createEventReminderEmbed(definition, schedule, currentFeast, appEmojis)], allowedMentions: { parse: [] } });
              rememberCrops();
              continue;
            }
            if (previous.signature === signature) continue;
          }

          await sendEventReminder(guildId, channel, definition, schedule, config.roles[definition.key], { feast: currentFeast, cropsChanged: lastSent === schedule.windowStartAt });
          rememberCrops();
          statusChanged = true;

          updateReminderState(guildId, (latest) => ({
            lastSentStarts: {
              ...latest.lastSentStarts,
              [definition.key]: schedule.windowStartAt
            }
          }));
        }

        if (statusChanged) {
          await mayorAlerts?.refreshStatusForGuild?.(guildId, electionData);
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

    const statusLine = options.cropsChanged ? `${definition.label}: new in-season crops are available.` : getReminderStatusLine(definition, schedule);
    const discordIcon = appEmojis.get(definition.icon, definition.emoji);
    const discordStatusLine = options.cropsChanged
      ? `${discordIcon} ${statusLine}`
      : getReminderStatusLine(definition, schedule, discordIcon);
    const content = roleId ? [`<@&${roleId}>`, discordStatusLine].join('\n') : discordStatusLine;

    const sentMessage = await channel.send({
      content,
      embeds: [createEventReminderEmbed(definition, schedule, options.feast, appEmojis)],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
    });

    await minecraft?.sendEventMessage?.(
      definition.key,
      definition.label,
      statusLine,
      { isTest: options.isTest === true }
    );

    updateReminderState(guildId, (latest) => ({
      channelId: sentMessage.channelId,
      messageIds: {
        ...latest.messageIds,
        [definition.key]: sentMessage.id
      },
      messageExpireAts: {
        ...latest.messageExpireAts,
        [definition.key]: getReminderDeleteAt(schedule)
      }
    }));
  }

  async function sendTestReminder(guildId, eventKey) {
    const definition = EVENT_DEFINITIONS.find((entry) => entry.key === eventKey);
    if (!definition) {
      throw new Error(`Unknown event reminder key: ${eventKey}`);
    }

    const config = store.getGuildConfig(guildId).eventReminders;
    const channel = await getReminderChannel(guildId);
    const electionData = await loadElectionDataForSchedules({ logErrors: false });
    const schedule = {
      ...definition.getSchedule(Date.now(), getScheduleContext(electionData)),
      isActive: true
    };

    const feast = definition.feast ? await feastProvider?.getCurrent().catch(() => null) : null;
    await sendEventReminder(guildId, channel, definition, schedule, config.roles[definition.key], { isTest: true, feast: matchFeast(definition, feast) });
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

    updateReminderState(guildId, (latest) => ({
      channelId: latestMessage.channelId,
      messageIds: {
        ...latest.messageIds,
        [eventKey]: latestMessage.id
      }
    }));

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

    updateReminderState(guildId, {
      channelId: channel.id,
      messageIds: nextMessageIds,
      messageExpireAts: nextMessageExpireAts
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

  // Older reminders still carry the Unicode emoji in the title.
  const titles = [`${definition.label} is ACTIVE`, `${definition.emoji} ${definition.label} is ACTIVE`];
  if (message.embeds.some((embed) => titles.includes(embed.title))) {
    return true;
  }

  return typeof message.content === 'string' && message.content.includes(`${definition.label} is active now.`);
}

function createEventReminderEmbed(definition, schedule, feast = null, appEmojis = NO_APP_EMOJIS) {
  const displayStartAt = getDisplayStartAt(schedule);
  const displayEndAt = getDisplayEndAt(schedule);
  const lines = [];

  if (Number.isFinite(displayStartAt)) {
    lines.push(`Start: <t:${Math.floor(displayStartAt / 1000)}:F>`);
  }

  if (Number.isFinite(displayEndAt)) {
    lines.push(`End: <t:${Math.floor(displayEndAt / 1000)}:F>`);
  }

  const durationLine = formatScheduleDuration(displayStartAt, displayEndAt);
  if (durationLine) {
    lines.push(durationLine);
  }

  if (typeof definition.extraLines === 'function') {
    lines.push(...definition.extraLines(schedule));
  }

  if (lines.length === 0) {
    lines.push('Schedule depends on mayor election data.');
  }

  // Titles do not render custom emojis; the item icon is the thumbnail and leads the ping text.
  const embed = new EmbedBuilder()
    .setColor(definition.color)
    .setTitle(`${definition.label} is ACTIVE`)
    .setDescription(lines.join('\n'))
    .setTimestamp();
  const iconUrl = definition.icon ? appEmojis.url(definition.icon) : null;
  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }
  if (typeof definition.reminderFields === 'function') {
    const fields = definition.reminderFields(schedule);
    if (fields.length > 0) {
      embed.addFields(...fields);
    }
  }
  if (definition.feast) {
    if (feast?.available) {
      embed.addFields(
        { name: 'In-season crops', value: `${feast.crops.join(', ')}\nUntil <t:${Math.floor(feast.until / 1000)}:R>` },
        { name: 'Upcoming crops', value: feast.upcoming.length ? feast.upcoming.map(([at, crops]) => `<t:${Math.floor(at / 1000)}:R>: ${crops.join(', ')}`).join('\n') : 'No further rotations reported yet.' }
      ).setFooter({ text: 'EliteSkyBlock community data • New ping when confirmed crops change' });
    } else embed.addFields({ name: 'In-season crops', value: 'No confirmed current crop data available yet.' });
  }
  return embed;
}

module.exports = { createEventRemindersService };
