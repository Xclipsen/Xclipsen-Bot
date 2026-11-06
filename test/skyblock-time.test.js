process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DAY_MS,
  EPOCH_MS,
  MONTH_MS,
  YEAR_MS,
  dateOffsetMs,
  getWeatherTierWindow,
  mod,
  skyBlockYearAt,
  yearPositionAt,
  yearStartAt,
  yearStartOfSkyBlockYear
} = require('../src/utils/skyblockTime');
const { createSkyblockUtils, normalizeText, stripMinecraftFormatting } = require('../src/utils/skyblock');

const at = (iso) => Date.parse(iso);

test('SkyBlock calendar constants and year helpers', () => {
  assert.equal(new Date(EPOCH_MS).toISOString(), '2019-06-11T17:55:00.000Z');
  assert.equal(DAY_MS, 20 * 60 * 1000);
  assert.equal(MONTH_MS, 31 * DAY_MS);
  assert.equal(YEAR_MS, 124 * 60 * 60 * 1000);
  assert.equal(mod(-1, 3), 2);

  const year521 = yearStartOfSkyBlockYear(521);
  assert.equal(skyBlockYearAt(year521), 521);
  assert.equal(skyBlockYearAt(year521 - 1), 520);
  assert.equal(yearStartAt(year521 + YEAR_MS - 1), year521);
  assert.equal(yearPositionAt(year521 + 5), 5);
  assert.equal(dateOffsetMs('Early Autumn'), 6 * MONTH_MS);
  assert.equal(dateOffsetMs('Late Winter', 24), (11 * MONTH_MS) + (23 * DAY_MS));
  assert.throws(() => dateOffsetMs('Monsoon'), /Unknown SkyBlock month/);
});

test('weather tier windows: the running window of the tier, else its next one', () => {
  assert.equal(getWeatherTierWindow(at('2026-10-21T17:40:00Z'), 'extreme').startAt, at('2026-10-21T17:35:00Z'));
  assert.equal(getWeatherTierWindow(at('2026-10-21T17:40:00Z'), 'mild').startAt, at('2026-10-21T18:35:00Z'));
  assert.equal(getWeatherTierWindow(at('2026-10-21T17:55:00Z'), 'extreme').startAt, at('2026-10-21T20:35:00Z'));
});

test('the status footer clock moves in 10-minute steps within each 50-second SkyBlock hour', (t) => {
  const skyblock = createSkyblockUtils();
  const year521 = yearStartOfSkyBlockYear(521);
  const clockAt = (offsetMs) => {
    t.mock.method(Date, 'now', () => year521 + offsetMs);
    const text = skyblock.formatSkyBlockDate(30);
    t.mock.restoreAll();
    return text;
  };

  assert.equal(clockAt(0), '1st of Early Spring, Year 521 - 12:00am');
  assert.equal(clockAt(8_334), '1st of Early Spring, Year 521 - 12:10am');
  assert.equal(clockAt(49_999), '1st of Early Spring, Year 521 - 12:50am');
  assert.equal(clockAt((13 * 50_000) + (3 * 8_334)), '1st of Early Spring, Year 521 - 1:30pm');
  assert.equal(clockAt(DAY_MS + MONTH_MS), '2nd of Spring, Year 521 - 12:00am');
  assert.equal(skyblock.formatSkyBlockDate(721), skyblock.formatSkyBlockDate(1000));
});

test('the election booth opens on day 181 and closes on day 88 of the next year', () => {
  const { getElectionSchedule } = createSkyblockUtils();
  const year521 = yearStartOfSkyBlockYear(521);
  assert.deepEqual(getElectionSchedule(year521 + (88 * DAY_MS) - 1), { boothOpen: true, nextTransitionAt: year521 + (88 * DAY_MS) });
  assert.deepEqual(getElectionSchedule(year521 + (88 * DAY_MS)), { boothOpen: false, nextTransitionAt: year521 + (181 * DAY_MS) });
  assert.deepEqual(getElectionSchedule(year521 + (181 * DAY_MS)), { boothOpen: true, nextTransitionAt: year521 + YEAR_MS + (88 * DAY_MS) });
});

test('Minecraft formatting is stripped before names are compared', () => {
  assert.equal(stripMinecraftFormatting('§aGrand §lFeast'), 'Grand Feast');
  assert.equal(normalizeText(' §6Finnegan '), 'finnegan');
  assert.equal(normalizeText(null), '');
});
