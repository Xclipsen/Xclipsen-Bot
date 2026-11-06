const {
  DAY_MS,
  MONTH_MS,
  YEAR_MS,
  SKYBLOCK_MONTHS,
  ELECTION_OPEN_START_DAY,
  ELECTION_CLOSE_DAY,
  EPOCH_MS,
  mod,
  skyBlockYearAt,
  yearPositionAt
} = require('./skyblockTime');

// A SkyBlock hour lasts 50 real seconds; the in-game clock moves in 10-minute steps.
const SKYBLOCK_HOUR_MS = DAY_MS / 24;

function stripMinecraftFormatting(text) {
  return String(text || '').replace(/§./g, '');
}

// Comparable form of names from the Hypixel API, which may carry § colour codes.
function normalizeText(value) {
  return stripMinecraftFormatting(value).trim().toLowerCase();
}

function toDiscordTimestamp(timestamp, style = 'f') {
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function getOrdinal(value) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

function getSkyBlockDateParts(now = Date.now()) {
  const offsetMs = now - EPOCH_MS;
  return {
    year: skyBlockYearAt(now),
    month: SKYBLOCK_MONTHS[mod(Math.floor(offsetMs / MONTH_MS), 12)],
    day: mod(Math.floor(offsetMs / DAY_MS), 31) + 1,
    hour: mod(Math.floor(offsetMs / SKYBLOCK_HOUR_MS), 24),
    minute: mod(Math.floor((6 * offsetMs) / SKYBLOCK_HOUR_MS), 6) * 10
  };
}

function formatSkyBlockTime(hour, minute) {
  const suffix = hour >= 12 ? 'pm' : 'am';
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, '0')}${suffix}`;
}

function formatSkyBlockDate(maxAgeMinutes) {
  const date = getSkyBlockDateParts();
  const baseDate = `${getOrdinal(date.day)} of ${date.month}, Year ${date.year}`;

  if (maxAgeMinutes <= 120) {
    return `${baseDate} - ${formatSkyBlockTime(date.hour, date.minute)}`;
  }

  if (maxAgeMinutes <= 720) {
    return baseDate;
  }

  return `${date.month}, Year ${date.year}`;
}

// The booth is open from day 181 until day 88 of the next year.
function getElectionSchedule(now = Date.now()) {
  const positionMs = yearPositionAt(now);
  const openStartMs = ELECTION_OPEN_START_DAY * DAY_MS;
  const closeMs = ELECTION_CLOSE_DAY * DAY_MS;
  const boothOpen = positionMs >= openStartMs || positionMs < closeMs;
  const nextTransitionMs = boothOpen
    ? (positionMs < closeMs ? closeMs : YEAR_MS + closeMs)
    : openStartMs;

  return {
    boothOpen,
    nextTransitionAt: now + (nextTransitionMs - positionMs)
  };
}

function getElectionTimingLine(isOpen) {
  const targetTimestamp = getElectionSchedule().nextTransitionAt;
  return isOpen
    ? `Election ends: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
    : `Next election opens: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`;
}

function createSkyblockUtils() {
  return {
    stripMinecraftFormatting,
    formatSkyBlockDate,
    getElectionSchedule,
    getElectionTimingLine
  };
}

module.exports = { createSkyblockUtils, stripMinecraftFormatting, normalizeText };
