const { env } = require('../config/env');

const YEAR_MS = env.SKYBLOCK_YEAR_SECONDS * 1000;
const DAY_MS = env.SKYBLOCK_DAY_SECONDS * 1000;
const MONTH_MS = DAY_MS * 31;
const EPOCH_MS = env.SKYBLOCK_EPOCH_SECONDS * 1000;
const SHORT_REMINDER_MS = 60 * 1000;
const WEATHER_ANCHOR_MS = (env.SKYBLOCK_EPOCH_SECONDS + (40 * 60)) * 1000;
const WEATHER_PERIOD_MS = 60 * 60 * 1000;
const WEATHER_DURATION_MS = 20 * 60 * 1000;
const LEGENDARY_ZOO_PETS = ['Giraffe', 'Tiger', 'Elephant', 'Monkey'];

function normalizeModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function getYearPositionMs(now) {
  return normalizeModulo(now - EPOCH_MS, YEAR_MS);
}

function getYearIndexAt(timestamp) {
  return Math.floor((timestamp - EPOCH_MS) / YEAR_MS);
}

function getMonthOffsetMs(monthIndex, day = 1) {
  return (monthIndex * MONTH_MS) + ((day - 1) * DAY_MS);
}

function resolveYearlyWindows(now, windows) {
  const yearPositionMs = getYearPositionMs(now);
  const active = [];
  const upcoming = [];

  for (const window of windows) {
    const startOffsetMs = window.startOffsetMs;
    const durationMs = window.durationMs;

    if (yearPositionMs >= startOffsetMs && yearPositionMs < (startOffsetMs + durationMs)) {
      const startAt = now - (yearPositionMs - startOffsetMs);
      active.push({
        ...window,
        startAt,
        endAt: startAt + durationMs,
        isActive: true
      });
      continue;
    }

    const nextStartAt = yearPositionMs < startOffsetMs
      ? now + (startOffsetMs - yearPositionMs)
      : now + ((YEAR_MS - yearPositionMs) + startOffsetMs);

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
  const resolvedWindow = resolveYearlyWindows(now, [
    { startOffsetMs: getMonthOffsetMs(0, 7), durationMs: DAY_MS / 4 },
    { startOffsetMs: getMonthOffsetMs(0, 14), durationMs: DAY_MS / 4 },
    { startOffsetMs: getMonthOffsetMs(0, 21), durationMs: DAY_MS / 4 },
    { startOffsetMs: getMonthOffsetMs(0, 28), durationMs: DAY_MS / 4 }
  ]);
  return buildSchedule(EVENT_DEFINITION_MAP.cultOfTheFallenStar, resolvedWindow);
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

function getAllEventSchedules(now = Date.now()) {
  return Object.fromEntries(EVENT_DEFINITIONS.map((definition) => [
    definition.key,
    definition.getSchedule(now)
  ]));
}

function getCalendarEntries(now = Date.now()) {
  const schedules = getAllEventSchedules(now);
  return EVENT_DEFINITIONS.map((definition) => ({
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

function formatCalendarEntry(entry) {
  const lines = [
    `${entry.emoji} ${entry.label}:`,
    `Start: <t:${Math.floor(getDisplayStartAt(entry) / 1000)}:F> (<t:${Math.floor(getDisplayStartAt(entry) / 1000)}:R>)`
  ];
  const displayEndAt = getDisplayEndAt(entry);
  if (Number.isFinite(displayEndAt)) {
    lines.push(`End: <t:${Math.floor(displayEndAt / 1000)}:F> (<t:${Math.floor(displayEndAt / 1000)}:R>)`);
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
  formatCalendarEntry
};
