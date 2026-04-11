const path = require('path');

const { createNameHistoryApiService, formatUuid: formatHistoryUuid } = require('../namehistory-api/service');

const STUFFY_UUID_POPULATION = 65340095;

function createMinecraftUtils() {
  const apiHeaders = { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' };
  const nameHistoryService = createNameHistoryApiService({
    host: '127.0.0.1',
    port: 0,
    cacheFilePath: path.join(process.cwd(), 'data', 'namehistory-cache.json'),
    staleMinutes: 60 * 24,
    apiKey: '',
    apiKeyHeader: 'X-API-Key',
    requireAuth: false,
    rateLimitMax: 60,
    rateLimitWindowMs: 60_000,
    requestTimeoutMs: 8_000,
    userAgent: 'hypixel-mayor-discord-bot/1.0.0',
    enableLabyFallback: true
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
      createdAt: null,
      history: profile.history.map((entry) => ({
        name: entry.name,
        changedAt: entry.changed_at,
        observedAt: entry.observed_at,
        censored: entry.censored
      })),
      historySource: 'laby',
      historySourceLabel: 'Laby.net'
    };
  }

  async function fetchNameHistory(playerName) {
    const profile = await nameHistoryService.getByUsername(playerName);
    return mapHistoryProfile(profile);
  }

  async function resolvePlayerProfile(playerName) {
    const response = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(playerName)}`,
      { headers: apiHeaders }
    );

    if (response.status === 204 || response.status === 404) {
      throw new Error('Player not found.');
    }

    if (!response.ok) {
      throw new Error(`Failed to look up player UUID (${response.status}).`);
    }

    const data = await response.json();
    return { uuid: data.id, name: data.name };
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
    scoreUuid,
    resolvePlayerProfile
  };
}

module.exports = { createMinecraftUtils };
