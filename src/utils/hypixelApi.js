const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const PROFILES_URL = 'https://api.hypixel.net/v2/skyblock/profiles';
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHED_PROFILE_UUIDS = 200;

// Shared Hypixel SkyBlock API access with short TTL caches, so features that run
// close together (e.g. /pest and the mayor check) reuse one response.
function createHypixelApi({ env, fetchImpl = (...args) => fetch(...args), now = () => Date.now(), ttlMs = CACHE_TTL_MS }) {
  const cache = new Map();

  function getCached(key, maxAgeMs) {
    const entry = cache.get(key);
    return entry && (now() - entry.fetchedAt) < maxAgeMs ? entry.value : null;
  }

  function setCached(key, value) {
    cache.delete(key);
    cache.set(key, { value, fetchedAt: now() });
    // Profile lookups are keyed by player; drop the oldest entries beyond the cap.
    const profileKeys = [...cache.keys()].filter((cacheKey) => cacheKey.startsWith('profiles:'));
    for (const staleKey of profileKeys.slice(0, Math.max(0, profileKeys.length - MAX_CACHED_PROFILE_UUIDS))) {
      cache.delete(staleKey);
    }
    return value;
  }

  async function requestJson(url, { label, headers = {} }) {
    const response = await fetchImpl(url, { headers: { 'User-Agent': env.USER_AGENT, ...headers } });

    if (response.status === 403 && headers['API-Key']) {
      throw new Error('Hypixel rejected the bot\'s API key (HYPIXEL_API_KEY).');
    }

    if (!response.ok) {
      throw new Error(`Hypixel ${label} API responded with ${response.status} ${response.statusText || ''}`.trim());
    }

    return response.json();
  }

  async function getBazaar() {
    const cached = getCached('bazaar', ttlMs);
    if (cached) {
      return cached;
    }

    const data = await requestJson(BAZAAR_URL, { label: 'Bazaar' });
    if (!data.success || !data.products) {
      throw new Error('Hypixel Bazaar API response did not contain product data.');
    }

    return setCached('bazaar', data.products);
  }

  // maxAgeMs: 0 forces a fresh request (the mayor checker); the result still refreshes the shared cache.
  async function getElection({ maxAgeMs = ttlMs } = {}) {
    const cached = getCached('election', maxAgeMs);
    if (cached) {
      return cached;
    }

    const data = await requestJson(env.ELECTION_URL, { label: 'Election' });
    if (!data.success || !data.mayor) {
      throw new Error('Hypixel Election API response did not contain mayor data.');
    }

    return setCached('election', data);
  }

  async function getProfiles(uuid) {
    if (!env.HYPIXEL_API_KEY) {
      throw new Error('HYPIXEL_API_KEY is missing. Add it to the bot environment first.');
    }

    const normalizedUuid = normalizeUuid(uuid);
    const cacheKey = `profiles:${normalizedUuid}`;
    const cached = getCached(cacheKey, ttlMs);
    if (cached) {
      return cached;
    }

    const data = await requestJson(`${PROFILES_URL}?uuid=${normalizedUuid}`, {
      label: 'SkyBlock profiles',
      headers: { 'API-Key': env.HYPIXEL_API_KEY }
    });
    if (!data.success) {
      throw new Error(data.cause || 'Hypixel API did not return profile data.');
    }

    return setCached(cacheKey, Array.isArray(data.profiles) ? data.profiles : []);
  }

  return { getBazaar, getElection, getProfiles };
}

function normalizeUuid(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '');
}

function getProfileName(profile) {
  return profile?.cute_name || profile?.cuteName || 'Unknown';
}

// Picks the player's profile: an explicitly requested name or id first, then the profile
// Hypixel marks as selected, then `fallback(candidates)` (default: the first profile).
function selectProfile(profiles, uuid, { profileName = null, profileId = null, fallback = (candidates) => candidates[0] } = {}) {
  const memberUuid = normalizeUuid(uuid);
  const candidates = (Array.isArray(profiles) ? profiles : [])
    .map((profile) => ({
      profile,
      profileId: normalizeUuid(profile?.profile_id),
      member: profile?.members?.[memberUuid],
      cuteName: getProfileName(profile),
      selected: profile?.selected === true
    }))
    .filter((entry) => entry.member);

  const requestedName = String(profileName || '').trim();
  if (requestedName) {
    const match = candidates.find((entry) => entry.cuteName.toLowerCase() === requestedName.toLowerCase());
    if (!match) {
      const availableProfiles = candidates.map((entry) => entry.cuteName).sort((left, right) => left.localeCompare(right));
      throw new Error(`Profile \`${requestedName}\` was not found. Available profiles: ${availableProfiles.map((name) => `\`${name}\``).join(', ')}`);
    }

    return match;
  }

  if (profileId) {
    const match = candidates.find((entry) => entry.profileId === normalizeUuid(profileId));
    if (!match) {
      throw new Error('This SkyBlock profile is no longer available.');
    }

    return match;
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.find((entry) => entry.selected) || fallback(candidates);
}

module.exports = { createHypixelApi, selectProfile, normalizeUuid };
