const STUFFY_UUID_POPULATION = 65340095;

function createMinecraftUtils() {
  const apiHeaders = { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' };
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  };

  function decodeHtml(value) {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, '\'')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
      .trim();
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeUuid(value) {
    return String(value || '').trim().toLowerCase().replace(/-/g, '');
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

  function addUnique(candidates, value) {
    if (!value || candidates.includes(value)) {
      return;
    }

    candidates.push(value);
  }

  function isNameMcChallengePage(html) {
    const normalizedHtml = String(html || '');
    return (
      /cf-turnstile-response/i.test(normalizedHtml)
      || /Performing security verification/i.test(normalizedHtml)
      || /Enable JavaScript and cookies to continue/i.test(normalizedHtml)
      || /Attention Required!/i.test(normalizedHtml)
      || /<title>\s*Just a moment/i.test(normalizedHtml)
    );
  }

  async function fetchHtmlPage(url) {
    const response = await fetch(url, {
      headers: browserHeaders,
      redirect: 'follow'
    });
    const html = await response.text();

    if (isNameMcChallengePage(html)) {
      const error = new Error('NameMC blocked the request with Cloudflare verification.');
      error.code = 'NAMEMC_BLOCKED';
      error.status = response.status;
      error.url = response.url || url;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`NameMC request failed (${response.status}).`);
      error.status = response.status;
      error.url = response.url || url;
      throw error;
    }

    return {
      html,
      url: response.url || url
    };
  }

  function extractVisibleTextLines(html) {
    const text = decodeHtml(
      String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(?:br|hr)\b[^>]*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|section|article|header|footer|main|aside|li|ul|ol|table|tbody|thead|tfoot|tr|h1|h2|h3|h4|h5|h6)>/gi, '\n')
        .replace(/<\/(?:td|th)>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    );

    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function parseUuidFromText(text) {
    const normalizedText = String(text || '');
    const dashedMatch = normalizedText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    if (dashedMatch) {
      return normalizeUuid(dashedMatch[0]);
    }

    const compactMatch = normalizedText.match(/\b[0-9a-f]{32}\b/i);
    return compactMatch ? normalizeUuid(compactMatch[0]) : null;
  }

  function parseNameMcChangedAt(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      return null;
    }

    const isoMatch = normalizedValue.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/);
    if (isoMatch) {
      return isoMatch[0];
    }

    const displayMatch = normalizedValue.match(/\b(\d{4}-\d{2}-\d{2})\s*[•-]\s*(\d{2}:\d{2}:\d{2})\b/);
    if (displayMatch) {
      return `${displayMatch[1]}T${displayMatch[2]}Z`;
    }

    return null;
  }

  function isNameMcSectionBoundary(line) {
    const normalizedLine = String(line || '').trim().replace(/^[*•]+\s*/, '');
    return (
      /^Followers(?: \(\d+\))?$/i.test(normalizedLine)
      || /^Skins(?: \(\d+\))?$/i.test(normalizedLine)
      || /^Head Command$/i.test(normalizedLine)
      || /^Favorite Servers$/i.test(normalizedLine)
      || /^Servers$/i.test(normalizedLine)
      || /^Badges$/i.test(normalizedLine)
      || /^Social Links$/i.test(normalizedLine)
      || /^Information$/i.test(normalizedLine)
      || /^Activity$/i.test(normalizedLine)
      || /^Collections$/i.test(normalizedLine)
      || /^Comments$/i.test(normalizedLine)
      || /^Friends$/i.test(normalizedLine)
      || /^Capes$/i.test(normalizedLine)
      || /^Profiles(?: \(\d+\))?$/i.test(normalizedLine)
      || /^First player seen wearing this skin:/i.test(normalizedLine)
    );
  }

  function parseNameMcHistory(lines) {
    const startIndex = lines.findIndex((line) => /^Name History$/i.test(line));
    if (startIndex === -1) {
      throw new Error('NameMC profile did not include a name history section.');
    }

    const sectionLines = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (sectionLines.length > 0 && isNameMcSectionBoundary(line)) {
        break;
      }

      sectionLines.push(line);
    }

    const entries = [];
    let currentEntry = null;

    const flushCurrentEntry = () => {
      if (!currentEntry?.name) {
        return;
      }

      entries.push(currentEntry);
      currentEntry = null;
    };

    for (const line of sectionLines) {
      const rowMatch = line.match(/^(\d+)\s+([A-Za-z0-9_]{3,16})(?:\s+|$)(.*)$/);
      if (rowMatch) {
        flushCurrentEntry();
        currentEntry = {
          index: Number.parseInt(rowMatch[1], 10),
          name: rowMatch[2],
          changedAt: parseNameMcChangedAt(rowMatch[3])
        };
        continue;
      }

      if (currentEntry && !currentEntry.changedAt) {
        currentEntry.changedAt = parseNameMcChangedAt(line);
      }
    }

    flushCurrentEntry();

    if (entries.length === 0) {
      throw new Error('NameMC name history section was empty.');
    }

    return entries
      .sort((left, right) => right.index - left.index)
      .map(({ index, ...entry }) => entry);
  }

  function parseNameMcProfile(html) {
    const lines = extractVisibleTextLines(html);
    const text = lines.join('\n');
    const uuid = parseUuidFromText(text);

    if (!uuid) {
      throw new Error('NameMC profile did not include a UUID.');
    }

    return {
      uuid,
      history: parseNameMcHistory(lines)
    };
  }

  function normalizeNameMcProfileUrl(profileUrl) {
    if (!profileUrl) {
      return null;
    }

    try {
      const url = new URL(profileUrl, 'https://namemc.com');
      if (!/^(?:[a-z]{2}\.)?namemc\.com$/i.test(url.hostname) || !url.pathname.startsWith('/profile/')) {
        return null;
      }

      return `https://namemc.com${url.pathname}`;
    } catch {
      return null;
    }
  }

  function parseNameMcProfileLinks(html) {
    const links = [];
    for (const match of String(html || '').matchAll(/href="([^"]*\/profile\/[^"#?]+)"/gi)) {
      addUnique(links, normalizeNameMcProfileUrl(decodeHtml(match[1])));
    }

    return links.filter(Boolean);
  }

  function buildNameMcDirectProfileCandidates(currentProfile) {
    const candidates = [];
    const hosts = ['https://namemc.com', 'https://en.namemc.com'];

    for (const host of hosts) {
      addUnique(candidates, `${host}/profile/${encodeURIComponent(currentProfile.name)}`);
      for (let variant = 1; variant <= 5; variant += 1) {
        addUnique(candidates, `${host}/profile/${encodeURIComponent(currentProfile.name)}.${variant}`);
      }
    }

    return candidates;
  }

  async function resolveNameMcProfileCandidatesBySearch(currentProfile) {
    const candidates = [];
    const hosts = ['https://namemc.com', 'https://en.namemc.com'];

    for (const query of [currentProfile.name, currentProfile.uuid, formatUuid(currentProfile.uuid)]) {
      for (const host of hosts) {
        const { html } = await fetchHtmlPage(`${host}/search?q=${encodeURIComponent(query)}`);
        for (const profileUrl of parseNameMcProfileLinks(html)) {
          addUnique(candidates, profileUrl);
        }
      }
    }

    return candidates;
  }

  async function tryNameMcProfileCandidates(currentProfile, profileCandidates) {
    let lastError = null;

    for (const profileUrl of profileCandidates) {
      try {
        const { html } = await fetchHtmlPage(profileUrl);
        const profile = parseNameMcProfile(html);

        if (normalizeUuid(profile.uuid) !== normalizeUuid(currentProfile.uuid)) {
          throw new Error('NameMC returned a profile that does not match the current Mojang UUID.');
        }

        const history = profile.history.slice();
        if (!history.some((entry) => normalizeName(entry.name) === normalizeName(currentProfile.name))) {
          history.unshift({ name: currentProfile.name, changedAt: null });
        }

        return history;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('NameMC did not return any profile candidates.');
  }

  async function fetchNameHistoryFromNameMc(currentProfile) {
    const directCandidates = buildNameMcDirectProfileCandidates(currentProfile);

    try {
      return await tryNameMcProfileCandidates(currentProfile, directCandidates);
    } catch (error) {
      const searchCandidates = await resolveNameMcProfileCandidatesBySearch(currentProfile);

      if (searchCandidates.length === 0) {
        throw error;
      }

      return tryNameMcProfileCandidates(currentProfile, searchCandidates);
    }
  }

  async function fetchNameHistory(playerName) {
    const currentProfile = await resolvePlayerProfile(playerName);
    const history = await fetchNameHistoryFromNameMc(currentProfile);

    return {
      uuid: currentProfile.uuid,
      name: currentProfile.name,
      createdAt: null,
      history,
      historySource: 'namemc',
      historySourceLabel: 'NameMC'
    };
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
    fetchNameHistory,
    formatUuid,
    getUuidData,
    scoreUuid,
    resolvePlayerProfile
  };
}

module.exports = { createMinecraftUtils };
