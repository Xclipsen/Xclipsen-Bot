const { env } = require('../config/env');

const YEAR_MS = env.SKYBLOCK_YEAR_SECONDS * 1000;
const DAY_MS = env.SKYBLOCK_DAY_SECONDS * 1000;
const MONTH_MS = DAY_MS * 31;
const EPOCH_MS = env.SKYBLOCK_EPOCH_SECONDS * 1000;
const SHORT_REMINDER_MS = 60 * 1000;
const REAL_MINUTE_MS = 60 * 1000;
const REAL_HOUR_MS = 60 * REAL_MINUTE_MS;
const REAL_DAY_MS = 24 * REAL_HOUR_MS;
const WEATHER_ANCHOR_MS = (env.SKYBLOCK_EPOCH_SECONDS + (40 * 60)) * 1000;
const WEATHER_PERIOD_MS = 60 * 60 * 1000;
const WEATHER_DURATION_MS = 20 * 60 * 1000;
const YEAR_OF_THE_CYCLE_YEARS = 12;
const YEAR_OF_THE_REMAINDERS = {
  seal: 6,
  witch: 8,
  pig: 11
};
const LEGENDARY_ZOO_PETS = ['Giraffe', 'Tiger', 'Elephant', 'Monkey'];
const HARVEST_FEAST_START_OFFSET_MS = getMonthOffsetMs(6, 1);
const HARVEST_FEAST_DURATION_MS = MONTH_MS * 3;

function normalizeModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function getYearPositionMs(now) {
  return normalizeModulo(now - EPOCH_MS, YEAR_MS);
}

function getYearIndexAt(timestamp) {
  return Math.floor((timestamp - EPOCH_MS) / YEAR_MS);
}

function getSkyBlockYearAt(timestamp) {
  return getYearIndexAt(timestamp) + 1;
}

function getYearStartAt(timestamp) {
  return EPOCH_MS + (getYearIndexAt(timestamp) * YEAR_MS);
}

function getYearStartBySkyBlockYear(year) {
  return EPOCH_MS + ((year - 1) * YEAR_MS);
}

function getMonthOffsetMs(monthIndex, day = 1) {
  return (monthIndex * MONTH_MS) + ((day - 1) * DAY_MS);
}

function resolveRepeatingWindows(now, cycleMs, windows) {
  const cyclePositionMs = normalizeModulo(now - EPOCH_MS, cycleMs);
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

function resolvePeriodicWindow(now, predicate) {
  const indexNow = Math.floor((now - WEATHER_ANCHOR_MS) / WEATHER_PERIOD_MS);
  let activeWindow = null;

  for (let index = indexNow - 2; index <= indexNow + 2; index += 1) {
    if (!predicate(index)) {
      continue;
    }

    const startAt = WEATHER_ANCHOR_MS + (index * WEATHER_PERIOD_MS);
    const endAt = startAt + WEATHER_DURATION_MS;
    if (startAt <= now && now < endAt) {
      activeWindow = {
        startAt,
        endAt,
        windowIndex: index,
        isActive: true
      };
      break;
    }
  }

  if (activeWindow) {
    return activeWindow;
  }

  for (let index = indexNow; index <= indexNow + 12; index += 1) {
    if (!predicate(index)) {
      continue;
    }

    const startAt = WEATHER_ANCHOR_MS + (index * WEATHER_PERIOD_MS);
    if (startAt <= now) {
      continue;
    }

    return {
      startAt,
      endAt: startAt + WEATHER_DURATION_MS,
      windowIndex: index,
      isActive: false
    };
  }

  const fallbackIndex = indexNow + 13;
  const fallbackStartAt = WEATHER_ANCHOR_MS + (fallbackIndex * WEATHER_PERIOD_MS);
  return {
    startAt: fallbackStartAt,
    endAt: fallbackStartAt + WEATHER_DURATION_MS,
    windowIndex: fallbackIndex,
    isActive: false
  };
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

function normalizeText(value) {
  return String(value || '')
    .replace(/§./g, '')
    .trim()
    .toLowerCase();
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
  if (Number.isFinite(context.mayorFetchedAt) && getYearIndexAt(context.mayorFetchedAt) !== getYearIndexAt(now)) {
    return null;
  }

  if (!hasGrandFeastPerk(context.mayor)) {
    return null;
  }

  const startAt = getYearStartAt(now);
  return {
    startAt,
    endAt: startAt + YEAR_MS,
    isActive: true
  };
}

function getSpiderRainSchedule(now) {
  const resolvedWindow = resolvePeriodicWindow(now, (index) => normalizeModulo(index, 3) !== 0);
  return buildSchedule(EVENT_DEFINITION_MAP.spiderRain, resolvedWindow);
}

function getSpiderThunderSchedule(now) {
  const resolvedWindow = resolvePeriodicWindow(now, (index) => normalizeModulo(index, 3) === 0);
  return buildSchedule(EVENT_DEFINITION_MAP.spiderThunder, resolvedWindow);
}

function getDarkAuctionSchedule(now) {
  const periodMs = 60 * 60 * 1000;
  const offsetMs = 55 * 60 * 1000;
  const periodPositionMs = normalizeModulo(now - offsetMs, periodMs);
  const currentStartAt = now - periodPositionMs;
  const currentEndAt = currentStartAt + SHORT_REMINDER_MS;
  const isActive = currentStartAt <= now && now < currentEndAt;
  const startAt = isActive ? currentStartAt : currentStartAt + periodMs;
  const endAt = startAt + SHORT_REMINDER_MS;

  return {
    key: 'darkAuction',
    isActive,
    windowStartAt: startAt,
    windowEndAt: endAt,
    displayStartAt: startAt,
    displayEndAt: null,
    reminderDeleteAt: endAt
  };
}

function getJerrysWorkshopSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(11, 1),
    durationMs: DAY_MS * 31
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.jerrysWorkshop, resolvedWindow);
}

function getSeasonOfJerrySchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(11, 24),
    durationMs: DAY_MS * 3
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.seasonOfJerry, resolvedWindow);
}

function getNewYearCelebrationSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(11, 29),
    durationMs: DAY_MS * 3
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.newYearCelebration, resolvedWindow);
}

function getBankInterestSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [
    { startOffsetMs: getMonthOffsetMs(0, 1), durationMs: SHORT_REMINDER_MS },
    { startOffsetMs: getMonthOffsetMs(3, 1), durationMs: SHORT_REMINDER_MS },
    { startOffsetMs: getMonthOffsetMs(6, 1), durationMs: SHORT_REMINDER_MS },
    { startOffsetMs: getMonthOffsetMs(9, 1), durationMs: SHORT_REMINDER_MS }
  ]);

  return buildSchedule(EVENT_DEFINITION_MAP.bankInterest, resolvedWindow, {
    displayEndAt: null
  });
}

function getHoppitysHuntSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(0, 1),
    durationMs: DAY_MS * 93
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.hoppitysHunt, resolvedWindow);
}

function getHarvestFeastSchedule(now, context = {}) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: HARVEST_FEAST_START_OFFSET_MS,
    durationMs: HARVEST_FEAST_DURATION_MS
  }]);
  const grandFeastWindow = getGrandFeastWindow(now, context);

  if (grandFeastWindow && resolvedWindow.startAt < grandFeastWindow.endAt) {
    const nextYearIndex = Math.ceil((grandFeastWindow.endAt - EPOCH_MS - HARVEST_FEAST_START_OFFSET_MS) / YEAR_MS);
    const startAt = EPOCH_MS + (nextYearIndex * YEAR_MS) + HARVEST_FEAST_START_OFFSET_MS;
    return buildSchedule(EVENT_DEFINITION_MAP.harvestFeast, {
      startAt,
      endAt: startAt + HARVEST_FEAST_DURATION_MS,
      isActive: false
    });
  }

  return buildSchedule(EVENT_DEFINITION_MAP.harvestFeast, resolvedWindow);
}

function getGrandFeastSchedule(now, context = {}) {
  const grandFeastWindow = getGrandFeastWindow(now, context);
  if (grandFeastWindow) {
    return buildSchedule(EVENT_DEFINITION_MAP.grandFeast, grandFeastWindow, {
      reason: 'Finnegan is mayor with the Grand Feast perk.'
    });
  }

  return {
    key: 'grandFeast',
    isActive: false,
    windowStartAt: null,
    windowEndAt: null,
    displayStartAt: null,
    displayEndAt: null,
    reminderDeleteAt: null,
    reason: 'Only active while Finnegan is mayor with the Grand Feast perk.'
  };
}

function getTravelingZooSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [
    { startOffsetMs: getMonthOffsetMs(3, 1), durationMs: DAY_MS * 3, slot: 0 },
    { startOffsetMs: getMonthOffsetMs(9, 1), durationMs: DAY_MS * 3, slot: 1 }
  ]);
  const zooIndex = (getYearIndexAt(resolvedWindow.startAt) * 2) + (resolvedWindow.slot || 0);
  const legendaryPet = LEGENDARY_ZOO_PETS[normalizeModulo(zooIndex - 2, LEGENDARY_ZOO_PETS.length)];

  return buildSchedule(EVENT_DEFINITION_MAP.travelingZoo, resolvedWindow, { legendaryPet });
}

function getSpookyFishingSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(7, 26),
    durationMs: DAY_MS * 9
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.spookyFishing, resolvedWindow);
}

function getSpookyFestivalSchedule(now) {
  const resolvedWindow = resolveYearlyWindows(now, [{
    startOffsetMs: getMonthOffsetMs(7, 29),
    durationMs: DAY_MS * 3
  }]);
  return buildSchedule(EVENT_DEFINITION_MAP.spookyFestival, resolvedWindow);
}

function getCultOfTheFallenStarSchedule(now) {
  const resolvedWindow = resolveMonthlyWindows(now, [
    { startOffsetMs: (7 - 1) * DAY_MS, durationMs: DAY_MS / 4 },
    { startOffsetMs: (14 - 1) * DAY_MS, durationMs: DAY_MS / 4 },
    { startOffsetMs: (21 - 1) * DAY_MS, durationMs: DAY_MS / 4 },
    { startOffsetMs: (28 - 1) * DAY_MS, durationMs: DAY_MS / 4 }
  ]);
  return buildSchedule(EVENT_DEFINITION_MAP.cultOfTheFallenStar, resolvedWindow);
}

function getYearOfTheSchedule(now, definition, cycleRemainder) {
  const currentYear = getSkyBlockYearAt(now);
  const currentRemainder = normalizeModulo(currentYear, YEAR_OF_THE_CYCLE_YEARS);
  const yearsUntil = currentRemainder === cycleRemainder
    ? 0
    : normalizeModulo(cycleRemainder - currentRemainder, YEAR_OF_THE_CYCLE_YEARS);
  const skyBlockYear = currentYear + yearsUntil;
  const startAt = getYearStartBySkyBlockYear(skyBlockYear);

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

function getYearOfTheSealSchedule(now) {
  return getYearOfTheSchedule(now, EVENT_DEFINITION_MAP.yearOfTheSeal, YEAR_OF_THE_REMAINDERS.seal);
}

function getYearOfTheWitchSchedule(now) {
  return getYearOfTheSchedule(now, EVENT_DEFINITION_MAP.yearOfTheWitch, YEAR_OF_THE_REMAINDERS.witch);
}

function getYearOfThePigSchedule(now) {
  return getYearOfTheSchedule(now, EVENT_DEFINITION_MAP.yearOfThePig, YEAR_OF_THE_REMAINDERS.pig);
}

function getSkyBlockYearExtraLines(schedule) {
  return Number.isFinite(schedule.skyBlockYear)
    ? [`SkyBlock Year: ${schedule.skyBlockYear}`]
    : [];
}

const EVENT_DEFINITIONS = [
  {
    key: 'spiderRain',
    label: "Spider's Den Rain",
    emoji: '🌧️',
    color: 0x5dade2,
    roleName: "Spider's Den Rain",
    roleAliases: ["spider's den rain", 'spiders den rain', 'spider rain', 'spider rain ping', 'spider rain role'],
    showEnd: true,
    getSchedule: getSpiderRainSchedule
  },
  {
    key: 'spiderThunder',
    label: "Spider's Den Thunder",
    emoji: '🌩️',
    color: 0x7f8c8d,
    roleName: "Spider's Den Thunder",
    roleAliases: ["spider's den thunder", 'spiders den thunder', 'spider thunder', 'spider thunder ping', 'spider thunder role'],
    showEnd: true,
    getSchedule: getSpiderThunderSchedule
  },
  {
    key: 'darkAuction',
    label: 'Dark Auction',
    emoji: '💵',
    color: 0x27ae60,
    roleName: 'Dark Auction',
    roleAliases: ['dark auction', 'dark auction ping', 'dark auction role', 'darkauction', 'da'],
    showEnd: false,
    getSchedule: getDarkAuctionSchedule
  },
  {
    key: 'jerrysWorkshop',
    label: "Jerry's Workshop",
    emoji: '☃️',
    color: 0xeaf2f8,
    roleName: "Jerry's Workshop",
    roleAliases: ["jerry's workshop", 'jerrys workshop', 'jerry workshop', "jerry's workshop ping", "jerry's workshop role"],
    showEnd: true,
    getSchedule: getJerrysWorkshopSchedule
  },
  {
    key: 'seasonOfJerry',
    label: 'Season of Jerry',
    emoji: '🎁',
    color: 0xd6eaf8,
    roleName: 'Season of Jerry',
    roleAliases: ['season of jerry', 'season of jerry ping', 'season of jerry role'],
    showEnd: true,
    getSchedule: getSeasonOfJerrySchedule
  },
  {
    key: 'newYearCelebration',
    label: 'New Year Celebration',
    emoji: '🎂',
    color: 0xf5cba7,
    roleName: 'New Year Celebration',
    roleAliases: ['new year celebration', 'new year', 'new year celebration ping', 'new year role'],
    showEnd: true,
    getSchedule: getNewYearCelebrationSchedule
  },
  {
    key: 'bankInterest',
    label: 'Bank Interest',
    emoji: '💰',
    color: 0xf4d03f,
    roleName: 'Bank Interest',
    roleAliases: ['bank interest', 'bank interest ping', 'bank interest role', 'interest'],
    showEnd: false,
    getSchedule: getBankInterestSchedule
  },
  {
    key: 'hoppitysHunt',
    label: "Hoppity's Hunt",
    emoji: '🐇',
    color: 0xe8daef,
    roleName: "Hoppity's Hunt",
    roleAliases: ["hoppity's hunt", 'hoppitys hunt', 'hoppity', "hoppity's hunt ping", "hoppity's hunt role"],
    showEnd: true,
    getSchedule: getHoppitysHuntSchedule
  },
  {
    key: 'yearOfTheSeal',
    label: 'Year of the Seal',
    emoji: '🦭',
    color: 0x48c9b0,
    roleName: 'Year of the Seal',
    roleAliases: [
      'year of the seal',
      'year of seal',
      'seal',
      'seal event',
      'seal ping',
      'year of the seal ping',
      'year of the seal role'
    ],
    showEnd: true,
    getSchedule: getYearOfTheSealSchedule,
    extraLines: getSkyBlockYearExtraLines
  },
  {
    key: 'yearOfTheWitch',
    label: 'Year of the Witch',
    emoji: '🧙',
    color: 0x8e44ad,
    roleName: 'Year of the Witch',
    roleAliases: [
      'year of the witch',
      'year of witch',
      'witch',
      'witch event',
      'witch ping',
      'year of the witch ping',
      'year of the witch role'
    ],
    showEnd: true,
    getSchedule: getYearOfTheWitchSchedule,
    extraLines: getSkyBlockYearExtraLines
  },
  {
    key: 'yearOfThePig',
    label: 'Year of the Pig',
    emoji: '🐷',
    color: 0xf1948a,
    roleName: 'Year of the Pig',
    roleAliases: [
      'year of the pig',
      'year of pig',
      'pig',
      'pig event',
      'shiny pig',
      'shiny pigs',
      'shiny pig ping',
      'year of the pig ping',
      'year of the pig role'
    ],
    showEnd: true,
    getSchedule: getYearOfThePigSchedule,
    extraLines: getSkyBlockYearExtraLines
  },
  {
    key: 'harvestFeast',
    label: 'Harvest Feast',
    emoji: '🥣',
    color: 0xd35400,
    roleName: 'Harvest Feast',
    roleAliases: ['harvest feast', 'feast', 'harvest feast ping', 'feast ping', 'harvest feast role', 'feast role'],
    showEnd: true,
    getSchedule: getHarvestFeastSchedule
  },
  {
    key: 'grandFeast',
    label: 'Grand Feast',
    emoji: '🍞',
    color: 0xf1c40f,
    roleName: 'Grand Feast',
    roleAliases: ['grand feast', 'grand feast ping', 'grand feast role', 'grand bakery'],
    showInCalendar: false,
    showEnd: true,
    getSchedule: getGrandFeastSchedule,
    extraLines: (schedule) => schedule.reason ? [schedule.reason] : []
  },
  {
    key: 'travelingZoo',
    label: 'Traveling Zoo',
    emoji: '🐘',
    color: 0xa9dfbf,
    roleName: 'Traveling Zoo',
    roleAliases: ['traveling zoo', 'zoo', 'traveling zoo ping', 'traveling zoo role', 'zoo role'],
    showEnd: true,
    getSchedule: getTravelingZooSchedule,
    extraLines: (schedule) => schedule.legendaryPet ? [`Leg. Pet: ${schedule.legendaryPet}`] : []
  },
  {
    key: 'spookyFishing',
    label: 'Spooky Fishing',
    emoji: '🐟',
    color: 0x9b59b6,
    roleName: 'Spooky Fishing',
    roleAliases: ['spooky fishing', 'fear mongerer', 'fear mongerer ping', 'spooky fishing role'],
    showEnd: true,
    getSchedule: getSpookyFishingSchedule
  },
  {
    key: 'spookyFestival',
    label: 'Spooky Festival',
    emoji: '🎃',
    color: 0xe67e22,
    roleName: 'Spooky Festival',
    roleAliases: ['spooky festival', 'spooky festival ping', 'spooky festival role', 'spooky'],
    showEnd: true,
    getSchedule: getSpookyFestivalSchedule
  },
  {
    key: 'cultOfTheFallenStar',
    label: 'Cult of the Fallen Star',
    emoji: '⭐',
    color: 0x8e44ad,
    roleName: 'Cult of the Fallen Star',
    roleAliases: [
      'cult of the fallen star',
      'fallen star cult',
      'cult ping',
      'cult of the fallen star ping',
      'cult of the fallen star role'
    ],
    showEnd: true,
    getSchedule: getCultOfTheFallenStarSchedule
  }
];

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
    .filter((definition) => definition.showInCalendar !== false)
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      emoji: definition.emoji,
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

function getReminderStatusLine(definition) {
  return `${definition.emoji} ${definition.label} is active now.`;
}

function formatDurationPart(value, singularUnit) {
  return `${value} ${singularUnit}${value === 1 ? '' : 's'}`;
}

function formatEventDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(durationMs / REAL_MINUTE_MS));
  const days = Math.floor(totalMinutes / (REAL_DAY_MS / REAL_MINUTE_MS));
  const remainingAfterDays = totalMinutes - (days * (REAL_DAY_MS / REAL_MINUTE_MS));
  const hours = Math.floor(remainingAfterDays / (REAL_HOUR_MS / REAL_MINUTE_MS));
  const minutes = remainingAfterDays - (hours * (REAL_HOUR_MS / REAL_MINUTE_MS));
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

function formatCalendarEntry(entry) {
  const displayStartAt = getDisplayStartAt(entry);
  const lines = [`${entry.emoji} ${entry.label}:`];

  if (Number.isFinite(displayStartAt)) {
    lines.push(`Start: <t:${Math.floor(displayStartAt / 1000)}:F> (<t:${Math.floor(displayStartAt / 1000)}:R>)`);
  } else {
    lines.push('Start: depends on mayor election');
  }

  const displayEndAt = getDisplayEndAt(entry);
  if (Number.isFinite(displayEndAt)) {
    lines.push(`End: <t:${Math.floor(displayEndAt / 1000)}:F> (<t:${Math.floor(displayEndAt / 1000)}:R>)`);
  }

  const durationLine = formatScheduleDuration(displayStartAt, displayEndAt);
  if (durationLine) {
    lines.push(durationLine);
  }

  const extraLines = typeof EVENT_DEFINITION_MAP[entry.key]?.extraLines === 'function'
    ? EVENT_DEFINITION_MAP[entry.key].extraLines(entry)
    : [];

  return [...lines, ...extraLines].join('\n');
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
  formatCalendarEntry
};
