const { env } = require('../config/env');
const { normalizeText } = require('../utils/skyblock');
const { DAY_MS, ELECTION_CLOSE_DAY, EPOCH_MS, YEAR_MS } = require('../utils/skyblockTime');

const WIKI_PAGE_BASE_URL = 'https://hypixelskyblock.minecraft.wiki/w/Candidate_Jerry/Perkpocalypse/Year_';
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_RETRY_MS = 15 * 60 * 1000;
const SUCCESS_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_ROTATION_LENGTH = 32;
const UPCOMING_SLOT_LIMIT = 5;
const FIELD_VALUE_LIMIT = 1024;

// A term starts when the election closes (Late Spring 27, 00:00), like the wiki's Module:Perkpocalypse.
const TERM_START_OFFSET_MS = ELECTION_CLOSE_DAY * DAY_MS;
// Perkpocalypse switches every 18 SkyBlock days (6 real hours); the last slot is cut off by the term end.
const SLOT_MS = 18 * DAY_MS;
const SLOTS_PER_TERM = Math.ceil(YEAR_MS / SLOT_MS);

// Perks Jerry activates for each rotation mayor, in in-game order.
// Source: hypixelskyblock.minecraft.wiki Module:Mayor/Data and Candidate_Jerry, checked 2026-10-21.
// Jerry never activates Finnegan's Grand Feast, so it is left out.
const ROTATION_MAYOR_PERKS = {
  Aatrox: [
    { name: 'SLASHED Pricing', description: 'Starting Slayer quests is half price.' },
    { name: 'Slayer XP Buff', description: 'Earn 25% more Slayer XP.' },
    { name: 'Pathfinder', description: 'Gain rare drops 20% more often.' }
  ],
  Cole: [
    { name: 'Prospection', description: 'Mining minions work 25% faster.' },
    { name: 'Mining XP Buff', description: '+60 Mining Wisdom on public islands.' },
    { name: 'Mining Fiesta', description: '+25 Mining Wisdom, +25% Mining Fortune; mining drops Refined Minerals and Glossy Gemstones.' },
    { name: 'Molten Forge', description: 'Forging items takes 25% less time.' }
  ],
  Diana: [
    { name: "Huntress' Intuition", description: 'Gain +10 Tracking.' },
    { name: 'Mythological Ritual', description: 'Diana sells the Griffin pet to hunt Mythological Creatures.' },
    { name: 'Pet XP Buff', description: 'Gain 35% more pet XP.' },
    { name: 'Sharing is Caring', description: '2 more Exp Share pet slots and +10% Exp Share rate.' }
  ],
  Finnegan: [
    { name: 'Pest Eradicator', description: "Pesthunter Phillip's Farming Fortune bonus lasts 60m; pest spawn cooldown -20%." },
    { name: 'GOATed', description: "Jacob's Farming Contest brackets include 10% more players." },
    { name: 'Blooming Business', description: 'Visitors give Fine Flour and +10% Copper; 5 extra visitors, rarer ones 20% more likely.' }
  ],
  Marina: [
    { name: 'Fishing XP Buff', description: '+50 Fishing Wisdom on public islands.' },
    { name: 'Luck of the Sea 2.0', description: 'Gain +15 Sea Creature Chance.' },
    { name: 'Fishing Festival', description: 'Shark fishing event during the first 3 days of each month.' },
    { name: 'Double Trouble', description: '+0.1 Double Hook Chance per 1 Sea Creature Chance.' }
  ],
  Paul: [
    { name: 'Marauder', description: 'Dungeon reward chests are 20% cheaper.' },
    { name: 'EZPZ', description: '+10 bonus score on dungeon runs.' },
    { name: 'Benediction', description: 'Blessings are 25% stronger.' }
  ]
};

const ROTATION_MAYOR_NOTES = {
  Finnegan: 'Grand Feast is not activated by Jerry.'
};

function isJerryMayor(mayor) {
  return normalizeText(mayor?.key) === 'jerry' || normalizeText(mayor?.name) === 'jerry';
}

function getTermIndexAt(timestamp) {
  return Math.floor((timestamp - EPOCH_MS - TERM_START_OFFSET_MS) / YEAR_MS);
}

function getTermStartAt(year) {
  return EPOCH_MS + ((year - 1) * YEAR_MS) + TERM_START_OFFSET_MS;
}

function getTermAt(timestamp) {
  const year = getTermIndexAt(timestamp) + 1;
  const termStartAt = getTermStartAt(year);
  return { year, termStartAt, termEndAt: termStartAt + YEAR_MS };
}

function normalizeMayorName(value) {
  const trimmed = String(value ?? '').replace(/^\[\[|\]\]$/g, '').trim();
  if (!trimmed) {
    return null;
  }

  let name = trimmed.replace(/^mayor\s+/i, '');
  if (name === trimmed) {
    name = trimmed.replace(/^candidate\s+/i, '');
  }

  name = name.trim();
  if (!/^[a-z][a-z' -]{0,31}$/i.test(name)) {
    return null;
  }

  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function parsePositiveInteger(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

// Same grammar as the wiki module: "3,7-9"; anything else makes the page invalid.
function parseStrikeSlots(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return [];
  }

  const slots = new Set();
  for (const item of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(item);
    if (!match) {
      return null;
    }

    const first = parsePositiveInteger(match[1]);
    const last = match[2] === undefined ? first : parsePositiveInteger(match[2]);
    if (!first || !last || last < first || last > 1000) {
      return null;
    }

    for (let slot = first; slot <= last; slot += 1) {
      slots.add(slot);
    }
  }

  return [...slots].sort((left, right) => left - right);
}

function findTemplateBody(text) {
  const start = /\{\{\s*perkpocalypse\s*(?=\||\}\})/i.exec(text);
  if (!start) {
    return null;
  }

  let depth = 0;
  for (let index = start.index; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === '{{') {
      depth += 1;
      index += 1;
    } else if (pair === '}}') {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return text.slice(start.index + 2, index - 1);
      }
    }
  }

  return null;
}

function splitTopLevelParams(body) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (let index = 0; index < body.length; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === '{{' || pair === '[[') {
      depth += 1;
      current += pair;
      index += 1;
    } else if ((pair === '}}' || pair === ']]') && depth > 0) {
      depth -= 1;
      current += pair;
      index += 1;
    } else if (body[index] === '|' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += body[index];
    }
  }

  parts.push(current);
  return parts;
}

// Parses the first {{Perkpocalypse}} template (main server) of a wiki year page.
function parsePerkpocalypseWikitext(text, expectedYear = null) {
  if (typeof text !== 'string') {
    return null;
  }

  const body = findTemplateBody(text.replace(/<!--[\s\S]*?-->/g, ''));
  if (body === null) {
    return null;
  }

  const params = {};
  for (const part of splitTopLevelParams(body).slice(1)) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex !== -1) {
      params[part.slice(0, separatorIndex).trim().toLowerCase()] = part.slice(separatorIndex + 1).trim();
    }
  }

  const year = parsePositiveInteger(params.year);
  if (!year || (expectedYear !== null && year !== expectedYear)) {
    return null;
  }

  let count = 0;
  for (const key of Object.keys(params)) {
    const match = /^mayor(\d+)$/.exec(key);
    if (match) {
      count = Math.max(count, Number(match[1]));
    }
  }

  const strike = parseStrikeSlots(params.strike);
  if (count < 1 || count > MAX_ROTATION_LENGTH || strike === null) {
    return null;
  }

  const mayors = [];
  const skipped = [];
  for (let position = 1; position <= count; position += 1) {
    const value = params[`mayor${position}`];
    if (String(value ?? '').trim() === '-') {
      mayors.push(null);
      skipped.push(position);
    } else {
      mayors.push(normalizeMayorName(value));
    }
  }

  return { year, mayors, skipped, strike };
}

function normalizeRotation(value) {
  const year = parsePositiveInteger(value?.year);
  if (!year || !Array.isArray(value.mayors) || value.mayors.length < 1 || value.mayors.length > MAX_ROTATION_LENGTH) {
    return null;
  }

  const positiveIntegers = (list) => (Array.isArray(list) ? list : [])
    .map((entry) => parsePositiveInteger(entry))
    .filter(Boolean);

  return {
    year,
    mayors: value.mayors.map((name) => normalizeMayorName(name)),
    skipped: positiveIntegers(value.skipped),
    strike: positiveIntegers(value.strike),
    fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0
  };
}

function isRotationComplete(rotation) {
  return rotation.mayors.every((name, index) => name || rotation.skipped.includes(index + 1));
}

// `slot` is 1-based like the wiki's `strike` parameter.
function buildSlot(term, rotation, index) {
  const startAt = term.termStartAt + (index * SLOT_MS);
  const endAt = Math.min(startAt + SLOT_MS, term.termEndAt);
  if (!rotation) {
    return { mayor: null, startAt, endAt, slot: index + 1, struck: false };
  }

  const position = index % rotation.mayors.length;
  return {
    mayor: rotation.mayors[position],
    startAt,
    endAt,
    slot: index + 1,
    struck: rotation.strike.includes(index + 1) || rotation.skipped.includes(position + 1)
  };
}

function resolvePerkpocalypseState(now, mayor, rotation = null, options = {}) {
  if (!isJerryMayor(mayor)) {
    return null;
  }

  const term = getTermAt(now);
  // Cached election data can still show Jerry for a few minutes after his term ended.
  const electionYear = Number(mayor?.election?.year);
  if (Number.isInteger(electionYear) && electionYear + 1 !== term.year) {
    return null;
  }

  if (Number.isFinite(options.mayorFetchedAt) && getTermIndexAt(options.mayorFetchedAt) + 1 !== term.year) {
    return null;
  }

  const order = rotation?.year === term.year ? rotation : null;
  const index = Math.floor((now - term.termStartAt) / SLOT_MS);
  const upcoming = [];
  for (let next = index + 1; next < SLOTS_PER_TERM && upcoming.length < UPCOMING_SLOT_LIMIT; next += 1) {
    upcoming.push(buildSlot(term, order, next));
  }

  return {
    year: term.year,
    termStartAt: term.termStartAt,
    termEndAt: term.termEndAt,
    slotMs: SLOT_MS,
    order: order ? [...order.mayors] : null,
    current: buildSlot(term, order, index),
    upcoming
  };
}

function getRotationMayorPerks(name) {
  return ROTATION_MAYOR_PERKS[name] || [];
}

function getRotationMayorNote(name) {
  return ROTATION_MAYOR_NOTES[name] || null;
}

function formatPerkNames(name) {
  const perks = getRotationMayorPerks(name);
  return perks.length > 0 ? perks.map((perk) => perk.name).join(', ') : 'perk list unknown';
}

function formatTimestamp(timestamp, style) {
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

// Never cuts a Discord token (custom emoji <:name:id>, timestamp <t:…>) in half.
function truncate(text, limit) {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 1).replace(/<[^<>\s]*$/, '')}…`;
}

function withIcon(name, mayorIcon) {
  const icon = mayorIcon(name);
  return icon ? `${icon} ${name}` : name;
}

function formatSlotHeadline(slot, mayorIcon) {
  if (slot.struck) {
    return slot.mayor ? `~~${slot.mayor}~~ (slot cancelled, no perks)` : 'No perks (slot cancelled)';
  }

  return slot.mayor
    ? `${withIcon(`**${slot.mayor}**`, () => mayorIcon(slot.mayor))}: ${formatPerkNames(slot.mayor)}`
    : '**Unknown mayor** (not published yet)';
}

function formatSlotMayor(slot, mayorIcon) {
  if (slot.struck) {
    return slot.mayor ? `~~${slot.mayor}~~` : '—';
  }

  return slot.mayor ? withIcon(slot.mayor, mayorIcon) : '?';
}

// mayorIcon(name): emoji shown in front of a mayor name ('' for none).
function formatPerkpocalypseField(state, { mayorIcon = () => '' } = {}) {
  if (!state?.current) {
    return null;
  }

  const { current } = state;
  const lines = [];
  if (!state.order) {
    lines.push(`Rotation order not published yet — perks switch every 6 hours (next switch ${formatTimestamp(current.endAt, 'R')})`);
  } else {
    lines.push(formatSlotHeadline(current, mayorIcon));
    lines.push(`until ${formatTimestamp(current.endAt, 't')} (${formatTimestamp(current.endAt, 'R')})`);

    const next = state.upcoming.slice(0, 3);
    if (next.length > 0) {
      lines.push(`Next: ${next.map((slot) => `${formatSlotMayor(slot, mayorIcon)} ${formatTimestamp(slot.startAt, 't')}`).join(' • ')}`);
    }

    lines.push(`Order: ${state.order.map((name) => (name ? withIcon(name, mayorIcon) : '?')).join(' → ')}`);
  }

  return {
    name: 'Perkpocalypse',
    value: truncate(lines.join('\n'), FIELD_VALUE_LIMIT),
    inline: false
  };
}

function createJerryRotation({
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  now: nowFn = Date.now,
  store = null,
  logger = console
} = {}) {
  const rotations = new Map();
  const fetchStatus = new Map();
  let pending = null;
  let lastMismatchWarning = null;

  loadPersistedRotation();

  function loadPersistedRotation() {
    try {
      const rotation = normalizeRotation(store?.getJerryRotationCache?.());
      if (rotation) {
        rotations.set(rotation.year, rotation);
        fetchStatus.set(rotation.year, { lastAttemptAt: rotation.fetchedAt, lastSuccessAt: rotation.fetchedAt, failed: false });
      }
    } catch (error) {
      logger.warn(`Could not load the stored Jerry Perkpocalypse order: ${error?.message || error}`);
    }
  }

  function persistRotation(rotation) {
    try {
      const stored = normalizeRotation(store?.getJerryRotationCache?.());
      const unchanged = stored
        && stored.year === rotation.year
        && JSON.stringify([stored.mayors, stored.skipped, stored.strike]) === JSON.stringify([rotation.mayors, rotation.skipped, rotation.strike]);
      if (!unchanged) {
        store?.setJerryRotationCache?.(rotation);
      }
    } catch (error) {
      logger.warn(`Could not store the Jerry Perkpocalypse order: ${error?.message || error}`);
    }
  }

  function isRefreshDue(year, nowMs) {
    const status = fetchStatus.get(year);
    if (!status) {
      return true;
    }

    if (status.failed) {
      return nowMs - status.lastAttemptAt >= FAILURE_RETRY_MS;
    }

    // Partially published orders get filled in during the term, so check those more often.
    const rotation = rotations.get(year);
    const interval = rotation && isRotationComplete(rotation) ? SUCCESS_REFRESH_MS : FAILURE_RETRY_MS;
    return nowMs - status.lastSuccessAt >= interval;
  }

  async function fetchRotation(year) {
    const startedAt = nowFn();
    const previous = fetchStatus.get(year) || {};

    try {
      const response = await fetchImpl(`${WIKI_PAGE_BASE_URL}${year}?action=raw`, {
        headers: { 'User-Agent': env.USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(response.status === 404 ? 'wiki page not published yet (HTTP 404)' : `wiki responded with HTTP ${response.status}`);
      }

      const parsed = parsePerkpocalypseWikitext(await response.text(), year);
      if (!parsed) {
        throw new Error('wiki page has no valid Perkpocalypse table');
      }

      const rotation = { ...parsed, fetchedAt: startedAt };
      const known = rotations.get(year);
      if (!known || JSON.stringify(known.mayors) !== JSON.stringify(rotation.mayors)) {
        logger.log(`Jerry Perkpocalypse order for Year ${year}: ${rotation.mayors.map((name) => name || '?').join(' → ')}`);
      }

      rotations.clear();
      rotations.set(year, rotation);
      fetchStatus.clear();
      fetchStatus.set(year, { lastAttemptAt: startedAt, lastSuccessAt: startedAt, failed: false });
      persistRotation(rotation);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'wiki request timed out' : (error?.message || String(error));
      // Log each distinct problem once instead of every retry.
      if (previous.loggedError !== message) {
        logger.warn(`Jerry Perkpocalypse order for Year ${year} unavailable: ${message}`);
      }

      fetchStatus.set(year, { ...previous, lastAttemptAt: startedAt, failed: true, loggedError: message });
    }
  }

  async function refresh(electionData) {
    try {
      const mayor = electionData?.mayor;
      if (!isJerryMayor(mayor)) {
        return;
      }

      const nowMs = nowFn();
      const { year } = getTermAt(nowMs);
      const electionYear = Number(mayor?.election?.year);
      if (Number.isInteger(electionYear) && electionYear + 1 !== year) {
        const warning = `${electionYear}:${year}`;
        if (lastMismatchWarning !== warning) {
          lastMismatchWarning = warning;
          logger.warn(`Jerry election year ${electionYear} does not match term year ${year}; waiting for fresh election data.`);
        }
        return;
      }

      if (!isRefreshDue(year, nowMs)) {
        return;
      }

      if (!pending || pending.year !== year) {
        const promise = fetchRotation(year).finally(() => {
          if (pending?.promise === promise) {
            pending = null;
          }
        });
        pending = { year, promise };
      }

      await pending.promise;
    } catch (error) {
      logger.warn(`Jerry Perkpocalypse refresh failed: ${error?.message || error}`);
    }
  }

  function getPerkpocalypseState(now = nowFn(), mayor = null, options = {}) {
    return resolvePerkpocalypseState(now, mayor, rotations.get(getTermAt(now).year) || null, options);
  }

  function getRotation(year) {
    return rotations.get(year) || null;
  }

  return {
    refresh,
    getPerkpocalypseState,
    getRotation
  };
}

// The status embed and the calendar read the state through the live rotation service when there
// is one, so both show the published order; without it only the slot times are known.
function getPerkpocalypseStateWith(jerryRotation, now, mayor, options = {}) {
  return typeof jerryRotation?.getPerkpocalypseState === 'function'
    ? jerryRotation.getPerkpocalypseState(now, mayor, options)
    : resolvePerkpocalypseState(now, mayor, null, options);
}

// The wiki lookup is best-effort; pings and status posts must still go out when it fails.
async function refreshJerryRotationSafely(jerryRotation, electionData) {
  try {
    await jerryRotation?.refresh?.(electionData);
  } catch (error) {
    console.warn('Jerry rotation refresh failed:', error?.message || error);
  }
}

module.exports = {
  SLOTS_PER_TERM,
  WIKI_PAGE_BASE_URL,
  createJerryRotation,
  formatPerkNames,
  formatPerkpocalypseField,
  getPerkpocalypseStateWith,
  getRotationMayorNote,
  getRotationMayorPerks,
  getTermAt,
  getTermStartAt,
  parsePerkpocalypseWikitext,
  refreshJerryRotationSafely,
  resolvePerkpocalypseState
};
