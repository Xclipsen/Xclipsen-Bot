const { EVENT_CATALOG } = require('../config/eventDefinitions');
const { normalizeText } = require('../utils/skyblock');
const {
  DAY_MS,
  EPOCH_MS,
  YEAR_MS,
  MONTH_MS,
  dateOffsetMs,
  getWeatherTierWindow,
  mod,
  skyBlockYearAt,
  yearIndexAt,
  yearStartAt,
  yearStartOfSkyBlockYear
} = require('../utils/skyblockTime');
const {
  formatPerkNames,
  getPerkpocalypseStateWith,
  getRotationMayorNote,
  getRotationMayorPerks
} = require('./jerryRotation');

const SHORT_REMINDER_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REAL_DAY_MS = 24 * HOUR_MS;
const EMBED_DESCRIPTION_LIMIT = 4096;
const YEAR_OF_THE_CYCLE_YEARS = 12;
const LEGENDARY_ZOO_PETS = ['Giraffe', 'Tiger', 'Elephant', 'Monkey'];

// Resolves the active window of a repeating cycle (aligned to the SkyBlock epoch), else the next one.
function resolveRepeatingWindows(now, cycleMs, windows) {
  const cyclePositionMs = mod(now - EPOCH_MS, cycleMs);
  const active = [];
  const upcoming = [];

  for (const window of windows) {
    const startOffsetMs = window.startOffsetMs;
    const durationMs = window.durationMs;

    if (cyclePositionMs >= startOffsetMs && cyclePositionMs < (startOffsetMs + durationMs)) {
      const startAt = now - (cyclePositionMs - startOffsetMs);
      active.push({
        ...window,
        startAt,
        endAt: startAt + durationMs,
        isActive: true
      });
      continue;
    }

    const nextStartAt = cyclePositionMs < startOffsetMs
      ? now + (startOffsetMs - cyclePositionMs)
      : now + ((cycleMs - cyclePositionMs) + startOffsetMs);

    upcoming.push({
      ...window,
      startAt: nextStartAt,
      endAt: nextStartAt + durationMs,
      isActive: false
    });
  }

  if (active.length > 0) {
    return active.sort((left, right) => left.startAt - right.startAt)[0];
  }

  return upcoming.sort((left, right) => left.startAt - right.startAt)[0];
}

function resolveYearlyWindows(now, windows) {
  return resolveRepeatingWindows(now, YEAR_MS, windows);
}

function resolveMonthlyWindows(now, windows) {
  return resolveRepeatingWindows(now, MONTH_MS, windows);
}

function getYearlyWindow({ month, day, days }) {
  return { startOffsetMs: dateOffsetMs(month, day), durationMs: days * DAY_MS };
}

function buildSchedule(definition, resolvedWindow, extra = {}) {
  return {
    key: definition.key,
    isActive: resolvedWindow.isActive,
    windowStartAt: resolvedWindow.startAt,
    windowEndAt: resolvedWindow.endAt,
    displayStartAt: resolvedWindow.startAt,
    displayEndAt: definition.showEnd === false ? null : resolvedWindow.endAt,
    reminderDeleteAt: Number.isFinite(extra.reminderDeleteAt)
      ? extra.reminderDeleteAt
      : (resolvedWindow.endAt ?? null),
    ...extra
  };
}

// Schedule of an event without a known window (it depends on the mayor).
function emptySchedule(definition, extra = {}) {
  return {
    key: definition.key,
    isActive: false,
    windowStartAt: null,
    windowEndAt: null,
    displayStartAt: null,
    displayEndAt: null,
    reminderDeleteAt: null,
    ...extra
  };
}

function getWeatherSchedule(definition, now) {
  const window = getWeatherTierWindow(now, definition.weather);
  return buildSchedule(definition, { ...window, isActive: window.startAt <= now && now < window.endAt });
}

function getYearlySchedule(definition, now) {
  return buildSchedule(definition, resolveYearlyWindows(now, [getYearlyWindow(definition.yearly)]));
}

function getYearOfSchedule(definition, now) {
  const currentYear = skyBlockYearAt(now);
  const yearsUntil = mod(definition.yearOf - currentYear, YEAR_OF_THE_CYCLE_YEARS);
  const skyBlockYear = currentYear + yearsUntil;
  const startAt = yearStartOfSkyBlockYear(skyBlockYear);

  return buildSchedule(
    definition,
    {
      startAt,
      endAt: startAt + YEAR_MS,
      isActive: yearsUntil === 0
    },
    { skyBlockYear }
  );
}

function getSkyBlockYearExtraLines(schedule) {
  return Number.isFinite(schedule.skyBlockYear)
    ? [`SkyBlock Year: ${schedule.skyBlockYear}`]
    : [];
}

function hasGrandFeastPerk(mayor) {
  const mayorKey = normalizeText(mayor?.key);
  const mayorName = normalizeText(mayor?.name);
  if (mayorKey !== 'finnegan' && mayorName !== 'finnegan') {
    return false;
  }

  return Array.isArray(mayor?.perks) && mayor.perks.some((perk) => normalizeText(perk?.name).includes('grand feast'));
}

function getGrandFeastWindow(now, context = {}) {
  if (Number.isFinite(context.mayorFetchedAt) && yearIndexAt(context.mayorFetchedAt) !== yearIndexAt(now)) {
    return null;
  }

  if (!hasGrandFeastPerk(context.mayor)) {
    return null;
  }

  const startAt = yearStartAt(now);
  return {
    startAt,
    endAt: startAt + YEAR_MS,
    isActive: true
  };
}

// The Dark Auction runs every third SkyBlock day (each real hour at :55 UTC), starting on the epoch day.
function getDarkAuctionSchedule(now) {
  return buildSchedule(EVENT_DEFINITION_MAP.darkAuction, resolveRepeatingWindows(now, HOUR_MS, [{
    startOffsetMs: 0,
    durationMs: SHORT_REMINDER_MS
  }]));
}

function getBankInterestSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, ['Early Spring', 'Early Summer', 'Early Autumn', 'Early Winter']
    .map((month) => ({ startOffsetMs: dateOffsetMs(month), durationMs: SHORT_REMINDER_MS })));
  return buildSchedule(EVENT_DEFINITION_MAP.bankInterest, resolvedWindow);
}

// A Grand Feast replaces the regular autumn feast of its year.
function getHarvestFeastSchedule(now, context = {}) {
  const definition = EVENT_DEFINITION_MAP.harvestFeast;
  const window = getYearlyWindow(definition.yearly);
  const resolvedWindow = resolveYearlyWindows(now, [window]);
  const grandFeastWindow = getGrandFeastWindow(now, context);

  if (grandFeastWindow && resolvedWindow.startAt < grandFeastWindow.endAt) {
    const nextYearIndex = Math.ceil((grandFeastWindow.endAt - EPOCH_MS - window.startOffsetMs) / YEAR_MS);
    const startAt = EPOCH_MS + (nextYearIndex * YEAR_MS) + window.startOffsetMs;
    return buildSchedule(definition, {
      startAt,
      endAt: startAt + window.durationMs,
      isActive: false
    });
  }

  return buildSchedule(definition, resolvedWindow);
}

function getGrandFeastSchedule(now, context = {}) {
  const definition = EVENT_DEFINITION_MAP.grandFeast;
  const grandFeastWindow = getGrandFeastWindow(now, context);
  if (grandFeastWindow) {
    return buildSchedule(definition, grandFeastWindow, {
      reason: 'Finnegan is mayor with the Grand Feast perk.'
    });
  }

  return emptySchedule(definition, {
    reason: 'Only active while Finnegan is mayor with the Grand Feast perk.'
  });
}

// Each 6-hour rotation slot is its own window, so every switch pings once; cancelled slots are skipped.
function getJerryPerkpocalypseSchedule(now, context = {}) {
  const definition = EVENT_DEFINITION_MAP.jerryPerkpocalypse;
  const state = getPerkpocalypseStateWith(context.jerryRotation, now, context.mayor, { mayorFetchedAt: context.mayorFetchedAt });
  const slot = state && (state.current.struck ? state.upcoming.find((entry) => !entry.struck) : state.current);

  if (!slot) {
    return emptySchedule(definition, {
      perkpocalypse: state,
      reason: state ? 'No further Perkpocalypse slots this term.' : 'Only active while Jerry is mayor.'
    });
  }

  return buildSchedule(definition, {
    startAt: slot.startAt,
    endAt: slot.endAt,
    isActive: slot === state.current
  }, {
    perkpocalypse: state,
    rotationMayor: slot.mayor,
    nextSlot: state.upcoming.find((entry) => entry.startAt >= slot.endAt) || null
  });
}

function getJerryPerkpocalypseStatusLine(schedule, icon = EVENT_DEFINITION_MAP.jerryPerkpocalypse.emoji) {
  return schedule?.rotationMayor
    ? `${icon} ${schedule.rotationMayor}'s perks are active now (Jerry's Perkpocalypse).`
    : `${icon} Jerry's Perkpocalypse: a new mayor's perks are active now.`;
}

function getJerryPerkpocalypseExtraLines(schedule) {
  const state = schedule.perkpocalypse;
  if (!state) {
    return schedule.reason ? [schedule.reason] : [];
  }

  const lines = [];
  if (state.current.struck) {
    lines.push('Now: no perks (slot cancelled)');
  } else if (schedule.rotationMayor) {
    lines.push(`Now: **${schedule.rotationMayor}** (${formatPerkNames(schedule.rotationMayor)})`);
  } else {
    lines.push('Now: unknown mayor (rotation order not published yet)');
  }

  // While a cancelled slot runs, the schedule window already is the next slot.
  const nextSlot = schedule.isActive
    ? schedule.nextSlot
    : (Number.isFinite(schedule.windowStartAt) ? { mayor: schedule.rotationMayor, startAt: schedule.windowStartAt, struck: false } : null);
  if (nextSlot) {
    const nextMayor = nextSlot.struck ? 'no perks (slot cancelled)' : (nextSlot.mayor || 'unknown mayor');
    lines.push(`Next: ${nextMayor} <t:${Math.floor(nextSlot.startAt / 1000)}:t>`);
  } else if (!Number.isFinite(schedule.windowStartAt) && schedule.reason) {
    lines.push(schedule.reason);
  }

  if (!state.order) {
    lines.push('Perks switch every 6 hours.');
  }

  return lines;
}

function getJerryPerkpocalypseReminderFields(schedule) {
  const perks = getRotationMayorPerks(schedule?.rotationMayor);
  if (perks.length === 0) {
    return [];
  }

  const note = getRotationMayorNote(schedule.rotationMayor);
  return [{
    name: `${schedule.rotationMayor}'s perks`,
    value: [...perks.map((perk) => `- **${perk.name}**: ${perk.description}`), ...(note ? [note] : [])].join('\n').slice(0, 1024)
  }];
}

function getTravelingZooSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [
    { ...getYearlyWindow({ month: 'Early Summer', day: 1, days: 3 }), slot: 0 },
    { ...getYearlyWindow({ month: 'Early Winter', day: 1, days: 3 }), slot: 1 }
  ]);
  const zooIndex = (yearIndexAt(resolvedWindow.startAt) * 2) + resolvedWindow.slot;
  const legendaryPet = LEGENDARY_ZOO_PETS[mod(zooIndex - 2, LEGENDARY_ZOO_PETS.length)];

  return buildSchedule(EVENT_DEFINITION_MAP.travelingZoo, resolvedWindow, { legendaryPet });
}

// On days 7, 14, 21 and 28 of every month, for a quarter of the day.
function getCultOfTheFallenStarSchedule(now) {
  const resolvedWindow = resolveMonthlyWindows(now, [7, 14, 21, 28]
    .map((day) => ({ startOffsetMs: (day - 1) * DAY_MS, durationMs: DAY_MS / 4 })));
  return buildSchedule(EVENT_DEFINITION_MAP.cultOfTheFallenStar, resolvedWindow);
}

// Schedules that cannot be described by the catalog data alone (see src/config/eventDefinitions.js).
const EVENT_BEHAVIOURS = {
  darkAuction: { getSchedule: getDarkAuctionSchedule },
  bankInterest: { getSchedule: getBankInterestSchedule },
  harvestFeast: { getSchedule: getHarvestFeastSchedule },
  grandFeast: {
    getSchedule: getGrandFeastSchedule,
    extraLines: (schedule) => schedule.reason ? [schedule.reason] : []
  },
  jerryPerkpocalypse: {
    showInCalendar: (schedule) => Boolean(schedule?.perkpocalypse),
    getSchedule: getJerryPerkpocalypseSchedule,
    statusLine: getJerryPerkpocalypseStatusLine,
    extraLines: getJerryPerkpocalypseExtraLines,
    reminderFields: getJerryPerkpocalypseReminderFields
  },
  travelingZoo: {
    getSchedule: getTravelingZooSchedule,
    extraLines: (schedule) => schedule.legendaryPet ? [`Leg. Pet: ${schedule.legendaryPet}`] : []
  },
  cultOfTheFallenStar: { getSchedule: getCultOfTheFallenStarSchedule }
};

function getDataSchedule(definition) {
  if (definition.weather) {
    return (now) => getWeatherSchedule(definition, now);
  }

  if (definition.yearly) {
    return (now) => getYearlySchedule(definition, now);
  }

  if (Number.isInteger(definition.yearOf)) {
    return (now) => getYearOfSchedule(definition, now);
  }

  throw new Error(`Event ${definition.key} has no schedule.`);
}

const EVENT_DEFINITIONS = EVENT_CATALOG.map((entry) => {
  const definition = { ...entry, ...EVENT_BEHAVIOURS[entry.key] };
  definition.getSchedule ||= getDataSchedule(definition);
  if (Number.isInteger(definition.yearOf)) {
    definition.extraLines ||= getSkyBlockYearExtraLines;
  }
  return definition;
});

const EVENT_DEFINITION_MAP = Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [definition.key, definition]));

function getAllEventSchedules(now = Date.now(), context = {}) {
  return Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [
    definition.key,
    definition.getSchedule(now, context)
  ]));
}

function getCalendarEntries(now = Date.now(), context = {}) {
  const schedules = getAllEventSchedules(now, context);
  return EVENT_DEFINITIONS
    .filter((definition) => (
      typeof definition.showInCalendar === 'function'
        ? definition.showInCalendar(schedules[definition.key])
        : definition.showInCalendar !== false
    ))
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      emoji: definition.emoji,
      icon: definition.icon,
      color: definition.color,
      ...schedules[definition.key]
    }));
}

function getDisplayStartAt(schedule) {
  return schedule?.displayStartAt ?? schedule?.windowStartAt ?? null;
}

function getDisplayEndAt(schedule) {
  return schedule?.displayEndAt ?? schedule?.windowEndAt ?? null;
}

function getReminderDeleteAt(schedule) {
  return schedule?.reminderDeleteAt
    ?? schedule?.windowEndAt
    ?? ((getDisplayStartAt(schedule) || Date.now()) + SHORT_REMINDER_MS);
}

// icon: the event's application emoji for Discord; the Minecraft bridge gets the Unicode default.
function getReminderStatusLine(definition, schedule = null, icon = definition.emoji) {
  const customLine = typeof definition.statusLine === 'function' ? definition.statusLine(schedule, icon) : null;
  return customLine || `${icon} ${definition.label} is active now.`;
}

function formatDurationPart(value, singularUnit) {
  return `${value} ${singularUnit}${value === 1 ? '' : 's'}`;
}

function formatEventDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(durationMs / (60 * 1000)));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(formatDurationPart(days, 'day'));
  }

  if (hours > 0) {
    parts.push(formatDurationPart(hours, 'hour'));
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(formatDurationPart(minutes, 'minute'));
  }

  return parts.slice(0, 2).join(' ');
}

function formatScheduleDuration(displayStartAt, displayEndAt) {
  if (!Number.isFinite(displayStartAt) || !Number.isFinite(displayEndAt)) {
    return null;
  }

  const duration = formatEventDurationMs(displayEndAt - displayStartAt);
  return duration ? `Lasts: ${duration}` : null;
}

function toUnixSeconds(timestamp) {
  return Math.floor(timestamp / 1000);
}

// Two lines per event: name with the next start (or the end, while active), then the exact window
// and its length; event-specific lines (SkyBlock year, Perkpocalypse mayors, ...) follow.
function formatCalendarEntry(entry, { icon = entry.emoji } = {}) {
  const displayStartAt = getDisplayStartAt(entry);
  const displayEndAt = getDisplayEndAt(entry);
  const hasStart = Number.isFinite(displayStartAt);
  const hasEnd = Number.isFinite(displayEndAt);
  const headline = [`${icon} **${entry.label}**`];

  if (entry.isActive) {
    headline.push('**now**');
    if (hasEnd) {
      headline.push(`ends <t:${toUnixSeconds(displayEndAt)}:R>`);
    }
  } else if (hasStart) {
    headline.push(`<t:${toUnixSeconds(displayStartAt)}:R>`);
  } else {
    headline.push('depends on mayor election');
  }

  const lines = [headline.join(' · ')];
  if (hasStart) {
    // Events of a day or longer show the end date too.
    const endStyle = hasEnd && (displayEndAt - displayStartAt) >= REAL_DAY_MS ? 'f' : 't';
    const window = hasEnd
      ? `<t:${toUnixSeconds(displayStartAt)}:f> – <t:${toUnixSeconds(displayEndAt)}:${endStyle}>`
      : `<t:${toUnixSeconds(displayStartAt)}:f>`;
    const duration = hasEnd ? formatEventDurationMs(displayEndAt - displayStartAt) : null;
    lines.push([window, duration].filter(Boolean).join(' · '));
  }

  const extraLines = typeof EVENT_DEFINITION_MAP[entry.key]?.extraLines === 'function'
    ? EVENT_DEFINITION_MAP[entry.key].extraLines(entry)
    : [];

  return [...lines, ...extraLines].join('\n');
}

// Whole entries only: whatever does not fit the embed description limit is summarised at the end.
function formatCalendarDescription(entries, { getIcon = (entry) => entry.emoji, maxLength = EMBED_DESCRIPTION_LIMIT } = {}) {
  const blocks = entries.map((entry) => formatCalendarEntry(entry, { icon: getIcon(entry) }));
  if (blocks.length === 0) {
    return 'No event data found.';
  }

  const shown = [];
  let length = 0;
  for (const [index, block] of blocks.entries()) {
    const remaining = blocks.length - index - 1;
    const reserve = remaining > 0 ? `\n…and ${remaining} more events`.length : 0;
    const nextLength = length + (shown.length > 0 ? 1 : 0) + block.length;
    if (nextLength + reserve > maxLength) {
      break;
    }
    shown.push(block);
    length = nextLength;
  }

  const hidden = blocks.length - shown.length;
  if (hidden > 0) {
    shown.push(`…and ${hidden} more event${hidden === 1 ? '' : 's'}`);
  }

  return shown.join('\n');
}

module.exports = {
  EVENT_DEFINITIONS,
  EVENT_DEFINITION_MAP,
  getAllEventSchedules,
  getCalendarEntries,
  getDisplayStartAt,
  getDisplayEndAt,
  getReminderDeleteAt,
  getReminderStatusLine,
  formatScheduleDuration,
  formatCalendarEntry,
  formatCalendarDescription
};
