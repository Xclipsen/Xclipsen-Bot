// SkyBlock calendar and island-weather time math shared by every schedule.
// A SkyBlock day lasts 20 real minutes, a month 31 days and a year 12 months (124 real hours).
const EPOCH_MS = 1560275700000; // Year 1, Early Spring 1, 00:00 (a real :55 UTC)
const DAY_MS = 20 * 60 * 1000;
const MONTH_MS = 31 * DAY_MS;
const YEAR_MS = 12 * MONTH_MS;

const SKYBLOCK_MONTHS = [
  'Early Spring',
  'Spring',
  'Late Spring',
  'Early Summer',
  'Summer',
  'Late Summer',
  'Early Autumn',
  'Autumn',
  'Late Autumn',
  'Early Winter',
  'Winter',
  'Late Winter'
];

// Day of the year (0-based) on which the election booth opens and closes; a mayor's term starts at the close.
const ELECTION_OPEN_START_DAY = 181;
const ELECTION_CLOSE_DAY = 88;

// Island weather: a 20-minute window every real hour at :35 UTC; every third one is EXTREME
// (02:35, 05:35, … 23:35 UTC, as in SkyblockAPI's WeatherAPI and the Feesh mod; checked
// in-game on 2026-10-21: Garden Rain, Mild, at 18:35 UTC).
const WEATHER_ANCHOR_MS = EPOCH_MS + (40 * 60 * 1000);
const WEATHER_PERIOD_MS = 60 * 60 * 1000;
const WEATHER_DURATION_MS = 20 * 60 * 1000;
const EXTREME_WINDOW_INTERVAL = 3;
const EXTREME_WINDOW_PHASE = 2;

function mod(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

// 0-based index of the SkyBlock year containing `timestamp`; the displayed year is this + 1.
function yearIndexAt(timestamp) {
  return Math.floor((timestamp - EPOCH_MS) / YEAR_MS);
}

function skyBlockYearAt(timestamp) {
  return yearIndexAt(timestamp) + 1;
}

function yearStartAt(timestamp) {
  return EPOCH_MS + (yearIndexAt(timestamp) * YEAR_MS);
}

function yearStartOfSkyBlockYear(year) {
  return EPOCH_MS + ((year - 1) * YEAR_MS);
}

// Milliseconds since the start of the current SkyBlock year.
function yearPositionAt(timestamp) {
  return mod(timestamp - EPOCH_MS, YEAR_MS);
}

// Offset of a SkyBlock date from the start of its year; `day` is 1-based like the in-game calendar.
function dateOffsetMs(monthName, day = 1) {
  const monthIndex = SKYBLOCK_MONTHS.indexOf(monthName);
  if (monthIndex === -1) {
    throw new Error(`Unknown SkyBlock month: ${monthName}`);
  }

  return (monthIndex * MONTH_MS) + ((day - 1) * DAY_MS);
}

function getWeatherWindowIndexAt(now) {
  return Math.floor((now - WEATHER_ANCHOR_MS) / WEATHER_PERIOD_MS);
}

function getWeatherWindow(index) {
  const startAt = WEATHER_ANCHOR_MS + (index * WEATHER_PERIOD_MS);
  return {
    index,
    tier: mod(index, EXTREME_WINDOW_INTERVAL) === EXTREME_WINDOW_PHASE ? 'extreme' : 'mild',
    startAt,
    endAt: startAt + WEATHER_DURATION_MS
  };
}

function getActiveWeatherWindow(now) {
  const window = getWeatherWindow(getWeatherWindowIndexAt(now));
  return window.startAt <= now && now < window.endAt ? window : null;
}

// The next window (optionally of one tier) that starts strictly after `now`.
function getNextWeatherWindow(now, tier = null) {
  const firstIndex = getWeatherWindowIndexAt(now) + 1;
  for (let index = firstIndex; index < firstIndex + EXTREME_WINDOW_INTERVAL; index += 1) {
    const window = getWeatherWindow(index);
    if (!tier || window.tier === tier) {
      return window;
    }
  }

  return null;
}

function getUpcomingWeatherWindows(now, count) {
  const firstIndex = getWeatherWindowIndexAt(now) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, offset) => getWeatherWindow(firstIndex + offset));
}

// The running window of `tier`, else its next one.
function getWeatherTierWindow(now, tier) {
  const activeWindow = getActiveWeatherWindow(now);
  return activeWindow?.tier === tier ? activeWindow : getNextWeatherWindow(now, tier);
}

module.exports = {
  EPOCH_MS,
  DAY_MS,
  MONTH_MS,
  YEAR_MS,
  SKYBLOCK_MONTHS,
  ELECTION_OPEN_START_DAY,
  ELECTION_CLOSE_DAY,
  mod,
  yearIndexAt,
  skyBlockYearAt,
  yearStartAt,
  yearStartOfSkyBlockYear,
  yearPositionAt,
  dateOffsetMs,
  getWeatherWindow,
  getActiveWeatherWindow,
  getNextWeatherWindow,
  getUpcomingWeatherWindows,
  getWeatherTierWindow
};
