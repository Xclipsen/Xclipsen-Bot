const { createNameHistoryApiService, formatUuid: formatHistoryUuid } = require('../namehistory-api/service');

const STUFFY_UUID_POPULATION = 65340095;
const PROFILE_REQUEST_TIMEOUT_MS = 8_000;

function createMinecraftUtils(env) {
  const apiHeaders = { 'User-Agent': env.USER_AGENT };
  const nameHistoryService = createNameHistoryApiService({
    cacheFilePath: env.NAMEHISTORY_CACHE_FILE_PATH,
    staleMinutes: 60 * 24,
    requestTimeoutMs: 8_000,
    userAgent: env.USER_AGENT,
    craftyApiKey: env.CRAFTY_API_KEY
  });

  function normalizeUuid(value) {
    return String(value || '').trim().toLowerCase().replace(/-/g, '');
  }

  function formatUuid(uuid) {
    return formatHistoryUuid(uuid);
  }

  function mapHistoryProfile(profile) {
    return {
      uuid: profile.uuid,
      name: profile.current_name,
      history: profile.history.map((entry) => ({
        name: entry.name,
        changedAt: entry.changed_at,
        censored: entry.censored,
        accurate: entry.accurate
      })),
      historySource: profile.history_source,
      historySourceLabel: { laby: 'Laby.net', crafty: 'Crafty.gg' }[profile.history_source] || 'Unavailable',
      historyStatus: profile.history_status,
      fetchedAt: profile.fetched_at,
      profileStale: profile.profile_stale
    };
  }

  function mapNameOwners(result) {
    return {
      name: result.name,
      status: result.status,
      owners: result.owners.map((owner) => ({
        uuid: owner.uuid,
        name: owner.current_name,
        changedAt: owner.changed_at,
        periods: owner.periods || null,
        profile: owner.profile ? mapHistoryProfile(owner.profile) : null
      }))
    };
  }

  async function fetchNameOwners(name, excludeUuid) {
    try {
      return mapNameOwners(await nameHistoryService.getNameOwners(name, { excludeUuid, withHistory: true }));
    } catch {
      return { name, status: 'unavailable', owners: [] };
    }
  }

  async function fetchNameHistory(playerName) {
    let profile;
    try {
      profile = await nameHistoryService.getByUsername(playerName);
    } catch (error) {
      // A name nobody owns right now may be an old name of a renamed account.
      if (error?.status !== 404) {
        throw error;
      }
      const query = String(playerName).trim();
      const nameOwners = await fetchNameOwners(query, null);
      if (nameOwners.owners.length === 0) {
        throw error;
      }
      // Owners are sorted by most recent use; show that account's full history.
      const latest = nameOwners.owners.find((owner) => owner.profile);
      if (!latest) {
        return { unclaimed: true, query: nameOwners.name, nameOwners };
      }
      return {
        ...latest.profile,
        formerName: nameOwners.name,
        formerNamePeriods: latest.periods,
        nameOwners: {
          ...nameOwners,
          former: true,
          owners: nameOwners.owners.filter((owner) => owner !== latest)
        }
      };
    }
    return {
      ...mapHistoryProfile(profile),
      nameOwners: await fetchNameOwners(profile.query, profile.uuid)
    };
  }

  async function resolvePlayerProfile(playerName) {
    const response = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(playerName)}`,
      {
        headers: apiHeaders,
        signal: AbortSignal.timeout(PROFILE_REQUEST_TIMEOUT_MS)
      }
    );

    if (response.status === 204 || response.status === 404) {
      throw new Error('Player not found.');
    }

    if (!response.ok) {
      throw new Error(`Failed to look up player UUID (${response.status}).`);
    }

    const data = await response.json().catch(() => null);
    const compactUuid = normalizeUuid(data?.id);
    const canonicalName = String(data?.name || '').trim();
    if (!/^[0-9a-f]{32}$/.test(compactUuid) || !/^[A-Za-z0-9_]{3,16}$/.test(canonicalName)) {
      throw new Error('Player lookup returned an invalid profile.');
    }

    return { uuid: formatUuid(compactUuid).toLowerCase(), name: canonicalName };
  }

  function scoreUuid(uuid) {
    const normalizedUuid = normalizeUuid(uuid);
    if (normalizedUuid.length !== 32) {
      return {
        score: 0,
        rank: 'Unranked',
        reasons: ['UUID format is invalid.']
      };
    }

    const value = BigInt(`0x${normalizedUuid}`);
    const maxValue = (1n << 128n) - 1n;
    const score = Number((value * 10000n + (maxValue / 2n)) / maxValue) / 100;
    const rank = score >= 99
      ? 'SS'
      : score >= 95
        ? 'S'
        : score >= 80
          ? 'A'
          : score >= 50
            ? 'B'
            : 'C';

    return {
      score,
      rank,
      reasons: [`numeric UUID percentile ${score.toFixed(2)}%`]
    };
  }

  function getUuidData(uuid) {
    const result = scoreUuid(uuid);
    const betterThanPercent = Number(result.score.toFixed(2));
    const normalizedUuid = normalizeUuid(uuid);
    const value = BigInt(`0x${normalizedUuid}`);
    const maxValue = (1n << 128n) - 1n;
    const position = Math.max(
      1,
      Number((((maxValue - value) * BigInt(STUFFY_UUID_POPULATION)) + (maxValue / 2n)) / maxValue)
    );

    return {
      ...result,
      betterThanPercent,
      position,
      totalPositions: STUFFY_UUID_POPULATION,
      summary: `That's better than ${betterThanPercent}% of all UUIDs!`,
      placement: `Position #${new Intl.NumberFormat('en-US').format(position)}.`,
      details: result.reasons.join(', ')
    };
  }

  return {
    fetchNameHistory,
    formatUuid,
    getUuidData,
    resolvePlayerProfile
  };
}

module.exports = { createMinecraftUtils };
