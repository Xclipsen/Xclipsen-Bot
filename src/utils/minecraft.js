const STUFFY_UUID_POPULATION = 65340095;

function createMinecraftUtils() {
  async function resolvePlayerProfile(playerName) {
    const response = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(playerName)}`,
      { headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' } }
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

  function formatUuid(uuid) {
    const normalizedUuid = String(uuid || '').trim().replace(/-/g, '');
    if (normalizedUuid.length !== 32) {
      return normalizedUuid;
    }

    return [
      normalizedUuid.slice(0, 8),
      normalizedUuid.slice(8, 12),
      normalizedUuid.slice(12, 16),
      normalizedUuid.slice(16, 20),
      normalizedUuid.slice(20)
    ].join('-');
  }

  function scoreUuid(uuid) {
    const normalizedUuid = String(uuid || '').trim().toLowerCase().replace(/-/g, '');
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
    const normalizedUuid = String(uuid || '').trim().toLowerCase().replace(/-/g, '');
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
    formatUuid,
    getUuidData,
    scoreUuid,
    resolvePlayerProfile
  };
}

module.exports = { createMinecraftUtils };
