function createSkyblockUtils(env) {
  function stripMinecraftFormatting(text) {
    return String(text || '').replace(/§./g, '');
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
    const offsetMs = now - (env.SKYBLOCK_EPOCH_SECONDS * 1000);
    const year = Math.floor(offsetMs / 446400000) + 1;
    const monthIndex = Math.floor(offsetMs / 37200000) % 12;
    const day = (Math.floor(offsetMs / 1200000) % 31) + 1;
    const hour = ((Math.floor(offsetMs / 50000) % 24) + 24) % 24;
    const minute = ((Math.floor((6 * offsetMs) / 50000) % 60) + 60) % 60;

    return {
      year,
      month: env.SKYBLOCK_MONTHS[(monthIndex + 12) % 12],
      day,
      hour,
      minute
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

  function getElectionSchedule(now = Date.now()) {
    const unixSeconds = now / 1000;
    const secondsSinceEpoch = unixSeconds - env.SKYBLOCK_EPOCH_SECONDS;
    const yearPositionSeconds = ((secondsSinceEpoch % env.SKYBLOCK_YEAR_SECONDS) + env.SKYBLOCK_YEAR_SECONDS) % env.SKYBLOCK_YEAR_SECONDS;
    const openStartSeconds = env.ELECTION_OPEN_START_DAY * env.SKYBLOCK_DAY_SECONDS;
    const closeSeconds = env.ELECTION_CLOSE_DAY * env.SKYBLOCK_DAY_SECONDS;
    const boothOpen = yearPositionSeconds >= openStartSeconds || yearPositionSeconds < closeSeconds;
    const nextTransitionSeconds = boothOpen
      ? (yearPositionSeconds < closeSeconds ? closeSeconds : env.SKYBLOCK_YEAR_SECONDS + closeSeconds)
      : openStartSeconds;

    return {
      boothOpen,
      nextTransitionAt: now + ((nextTransitionSeconds - yearPositionSeconds) * 1000)
    };
  }

  function getMayorTermEndAt(now = Date.now()) {
    const unixSeconds = now / 1000;
    const secondsSinceEpoch = unixSeconds - env.SKYBLOCK_EPOCH_SECONDS;
    const yearPositionSeconds = ((secondsSinceEpoch % env.SKYBLOCK_YEAR_SECONDS) + env.SKYBLOCK_YEAR_SECONDS) % env.SKYBLOCK_YEAR_SECONDS;
    const closeSeconds = env.ELECTION_CLOSE_DAY * env.SKYBLOCK_DAY_SECONDS;
    const nextCloseSeconds = yearPositionSeconds < closeSeconds
      ? closeSeconds
      : env.SKYBLOCK_YEAR_SECONDS + closeSeconds;

    return now + ((nextCloseSeconds - yearPositionSeconds) * 1000);
  }

  function getElectionWindow(now = Date.now()) {
    const unixSeconds = now / 1000;
    const secondsSinceEpoch = unixSeconds - env.SKYBLOCK_EPOCH_SECONDS;
    const yearPositionSeconds = ((secondsSinceEpoch % env.SKYBLOCK_YEAR_SECONDS) + env.SKYBLOCK_YEAR_SECONDS) % env.SKYBLOCK_YEAR_SECONDS;
    const openStartSeconds = env.ELECTION_OPEN_START_DAY * env.SKYBLOCK_DAY_SECONDS;
    const closeSeconds = env.ELECTION_CLOSE_DAY * env.SKYBLOCK_DAY_SECONDS;
    const boothOpen = yearPositionSeconds >= openStartSeconds || yearPositionSeconds < closeSeconds;

    if (boothOpen && yearPositionSeconds >= openStartSeconds) {
      return {
        boothOpen,
        startAt: now - ((yearPositionSeconds - openStartSeconds) * 1000),
        endAt: now + (((env.SKYBLOCK_YEAR_SECONDS + closeSeconds) - yearPositionSeconds) * 1000)
      };
    }

    if (boothOpen) {
      return {
        boothOpen,
        startAt: now - ((yearPositionSeconds + (env.SKYBLOCK_YEAR_SECONDS - openStartSeconds)) * 1000),
        endAt: now + ((closeSeconds - yearPositionSeconds) * 1000)
      };
    }

    return {
      boothOpen,
      startAt: now + ((openStartSeconds - yearPositionSeconds) * 1000),
      endAt: now + (((env.SKYBLOCK_YEAR_SECONDS + closeSeconds) - yearPositionSeconds) * 1000)
    };
  }

  function getElectionTimingLine(isOpen) {
    const targetTimestamp = getElectionSchedule().nextTransitionAt;
    return isOpen
      ? `Election ends: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
      : `Next election opens: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`;
  }

  return {
    stripMinecraftFormatting,
    formatSkyBlockDate,
    getElectionSchedule,
    getElectionWindow,
    getMayorTermEndAt,
    getElectionTimingLine,
    toDiscordTimestamp
  };
}

module.exports = { createSkyblockUtils };
