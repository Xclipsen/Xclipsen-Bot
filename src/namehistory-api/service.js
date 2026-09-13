const fs = require('fs');
const path = require('path');

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUuid(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '');
}

function formatUuid(value) {
  const normalized = normalizeUuid(value);
  if (normalized.length !== 32) {
    return normalized;
  }

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20)
  ].join('-');
}

function isValidUsername(value) {
  return /^[A-Za-z0-9_]{1,16}$/.test(String(value || '').trim());
}

function isValidUuid(value) {
  return /^[0-9a-f]{32}$/i.test(normalizeUuid(value));
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(contents);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createStorage(cacheFilePath) {
  const loaded = readJsonFile(cacheFilePath, {
    profiles: {},
    nameIndex: {}
  });
  const state = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};

  if (!state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) {
    state.profiles = {};
  }

  // Older caches indexed historical names too. Rebuild only current-name mappings.
  state.nameIndex = Object.create(null);
  for (const [uuid, profile] of Object.entries(state.profiles)) {
    if (isValidUuid(uuid) && isValidUsername(profile?.current_name)) {
      state.nameIndex[normalizeName(profile.current_name)] = uuid;
    }
  }

  function save() {
    writeJsonFile(cacheFilePath, state);
  }

  function removeNameMappingsForUuid(uuid) {
    for (const [name, mappedUuid] of Object.entries(state.nameIndex)) {
      if (mappedUuid === uuid) {
        delete state.nameIndex[name];
      }
    }
  }

  function indexProfile(profile) {
    const uuid = formatUuid(profile.uuid);
    state.profiles[uuid] = profile;
    removeNameMappingsForUuid(uuid);

    state.nameIndex[normalizeName(profile.current_name)] = uuid;

    save();
  }

  function getProfileByUuid(uuid) {
    const profile = state.profiles[formatUuid(uuid)];
    return profile && normalizeUuid(profile.uuid) === normalizeUuid(uuid)
      && isValidUsername(profile.current_name) && Array.isArray(profile.history)
      ? profile : null;
  }

  function getProfileByName(name) {
    const mappedUuid = state.nameIndex[normalizeName(name)];
    return mappedUuid ? getProfileByUuid(mappedUuid) : null;
  }

  function deleteProfileByUuid(uuid) {
    const formattedUuid = formatUuid(uuid);
    if (!state.profiles[formattedUuid]) {
      return null;
    }

    const existing = state.profiles[formattedUuid];
    delete state.profiles[formattedUuid];
    removeNameMappingsForUuid(formattedUuid);
    save();
    return existing;
  }

  function deleteProfileByName(name) {
    const existing = getProfileByName(name);
    if (!existing) {
      return null;
    }

    return deleteProfileByUuid(existing.uuid);
  }

  return {
    indexProfile,
    getProfileByUuid,
    getProfileByName,
    deleteProfileByUuid,
    deleteProfileByName
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
    headers: response.headers
  };
}

function createNameHistoryApiService(config) {
  const storage = createStorage(config.cacheFilePath);
  const providerRetryAt = new Map();
  const historyRetryAt = new Map();
  const pendingRefreshes = new Map();
  const defaultHeaders = {
    'User-Agent': config.userAgent
  };

  function createError(status, description, name = null) {
    return {
      status,
      body: {
        code: status,
        name: name || defaultStatusName(status),
        description
      }
    };
  }

  function defaultStatusName(status) {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 404:
        return 'Not Found';
      case 405:
        return 'Method Not Allowed';
      case 429:
        return 'Too Many Requests';
      case 503:
        return 'Service Unavailable';
      case 500:
      default:
        return 'Internal Server Error';
    }
  }

  function createAbortSignal() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    return {
      signal: controller.signal,
      dispose() {
        clearTimeout(timeout);
      }
    };
  }

  async function requestJson(url, headers = defaultHeaders) {
    const host = new URL(url).host;
    if (Date.now() < (providerRetryAt.get(host) || 0)) {
      throw new Error('Provider is rate limited.');
    }

    const timeout = createAbortSignal();
    try {
      const response = await fetchJson(url, { headers, signal: timeout.signal });
      const retryAfter = response.headers.get('retry-after');
      if (response.status === 429 || (response.status === 503 && retryAfter)) {
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const retryAt = Number.isFinite(seconds)
          ? Date.now() + Math.max(0, seconds) * 1000
          : Date.parse(retryAfter);
        providerRetryAt.set(host, Number.isFinite(retryAt) && retryAt > Date.now()
          ? retryAt : Date.now() + 60_000);
      }
      return response;
    } finally {
      timeout.dispose();
    }
  }

  async function resolveCurrentProfile(candidates, matches) {
    let unavailable = false;
    for (const url of candidates) {
      try {
        const response = await requestJson(url);
        if (response.status === 404 || response.status === 204) {
          continue;
        }
        if (!response.ok || !isValidUuid(response.data?.id)
          || !isValidUsername(response.data?.name) || !matches(response.data)) {
          throw new Error('Invalid profile response.');
        }
        return { uuid: formatUuid(response.data.id), name: response.data.name.trim() };
      } catch {
        // A failed primary endpoint must not prevent the secondary lookup.
        unavailable = true;
      }
    }
    if (unavailable) {
      throw createError(503, 'Minecraft profile lookup is temporarily unavailable. Please try again later.');
    }
    return null;
  }

  async function resolveCurrentProfileByUsername(username) {
    const encodedName = encodeURIComponent(username);
    return resolveCurrentProfile([
      `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodedName}`,
      `https://api.mojang.com/users/profiles/minecraft/${encodedName}`
    ], (profile) => normalizeName(profile.name) === normalizeName(username));
  }

  async function resolveCurrentProfileByUuid(uuid) {
    const compactUuid = normalizeUuid(uuid);
    return resolveCurrentProfile([
      `https://sessionserver.mojang.com/session/minecraft/profile/${compactUuid}`,
      `https://api.minecraftservices.com/minecraft/profile/lookup/${compactUuid}`
    ], (profile) => normalizeUuid(profile.id) === compactUuid);
  }

  function normalizeTimestamp(value, fallback = null) {
    if (!value) {
      return fallback;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function normalizeHistory(entries, source) {
    return entries.map((entry) => {
      const rawName = source === 'crafty' ? entry?.username : entry?.name;
      const censored = entry?.hidden === true || rawName === '-';
      if (!censored && !isValidUsername(rawName)) {
        throw new Error('Invalid history entry.');
      }
      return {
        name: censored ? '-' : rawName.trim(),
        changed_at: normalizeTimestamp(entry?.changed_at),
        observed_at: normalizeTimestamp(entry?.last_seen_at),
        censored,
        accurate: source === 'laby' && entry?.accurate === true && !censored
      };
    });
  }

  async function fetchLabyHistory(currentProfile) {
    const response = await requestJson(
      `https://laby.net/api/v3/user/${currentProfile.uuid}/snippet`
    );
    if (!response.ok || normalizeUuid(response.data?.user?.uuid) !== normalizeUuid(currentProfile.uuid)
      || !Array.isArray(response.data?.name_history)) {
      throw new Error('Laby history is unavailable or belongs to a different account.');
    }
    return { source: 'laby', history: normalizeHistory(response.data.name_history, 'laby') };
  }

  async function fetchCraftyHistory(currentProfile) {
    const headers = { ...defaultHeaders };
    if (config.craftyApiKey) {
      headers.Authorization = `Bearer ${config.craftyApiKey}`;
    }
    const response = await requestJson(
      `https://api.crafty.gg/api/v2/players/${currentProfile.uuid}`, headers
    );
    if (!response.ok || response.data?.success !== true
      || normalizeUuid(response.data?.data?.uuid) !== normalizeUuid(currentProfile.uuid)
      || !Array.isArray(response.data?.data?.usernames)) {
      throw new Error('Crafty history is unavailable or belongs to a different account.');
    }
    return { source: 'crafty', history: normalizeHistory(response.data.data.usernames, 'crafty') };
  }

  function buildProfileHistory({ query, currentProfile, result }) {
    const nowIso = new Date().toISOString();
    const history = [...result.history];
    history.sort((left, right) => (Date.parse(left.changed_at) || 0) - (Date.parse(right.changed_at) || 0));
    if (!history.some((entry) => normalizeName(entry.name) === normalizeName(currentProfile.name))) {
      history.push({
        name: currentProfile.name,
        changed_at: null,
        observed_at: nowIso,
        censored: false,
        accurate: false
      });
    }
    const lastSeenAt = history.reduce((latest, entry) => Math.max(latest, Date.parse(entry.observed_at) || 0), 0);
    return {
      schema_version: 2,
      query,
      uuid: currentProfile.uuid,
      current_name: currentProfile.name,
      last_seen_at: lastSeenAt > 0 ? new Date(lastSeenAt).toISOString() : null,
      fetched_at: nowIso,
      history_source: result.source,
      history_empty: result.history.length === 0,
      history: history.map((entry, index) => ({ id: index + 1, ...entry }))
    };
  }

  function isStale(profile) {
    const fetchedAt = Date.parse(profile?.fetched_at);
    return profile?.schema_version !== 2 || !Number.isFinite(fetchedAt)
      || fetchedAt > Date.now() || Date.now() - fetchedAt > config.staleMinutes * 60_000;
  }

  function cloneProfileWithQuery(profile, query, overrides = {}) {
    const legacy = profile.schema_version !== 2;
    return {
      query,
      uuid: profile.uuid,
      current_name: profile.current_name,
      last_seen_at: profile.last_seen_at,
      fetched_at: profile.fetched_at || null,
      history_source: profile.history_source || (legacy ? 'laby' : null),
      history_status: 'fresh',
      profile_stale: false,
      // The legacy cache conflated uncertain dates with hidden names. Its dates
      // cannot be recovered as exact, but valid visible names remain usable.
      history: profile.history.filter((entry) => isValidUsername(entry?.name) || entry?.name === '-')
        .map((entry) => ({
          ...entry,
          censored: entry.name === '-' || (!legacy && entry.censored === true),
          accurate: !legacy && entry.accurate === true
        })),
      ...overrides
    };
  }

  function unavailableHistory(query, currentProfile, cached) {
    if (cached) {
      return cloneProfileWithQuery(cached, query, {
        current_name: currentProfile.name,
        history_status: 'stale'
      });
    }
    return {
      query,
      uuid: currentProfile.uuid,
      current_name: currentProfile.name,
      last_seen_at: null,
      fetched_at: null,
      history_source: null,
      history_status: 'unavailable',
      profile_stale: false,
      history: []
    };
  }

  async function refreshByResolvedProfile(query, currentProfile, forceRefresh) {
    const uuid = currentProfile.uuid;
    const cached = storage.getProfileByUuid(uuid);
    if (cached && !forceRefresh && !isStale(cached)) {
      return cloneProfileWithQuery(cached, query, { current_name: currentProfile.name });
    }
    if (!forceRefresh && Date.now() < (historyRetryAt.get(uuid) || 0)) {
      return unavailableHistory(query, currentProfile, cached);
    }

    // Share provider work when multiple commands request the same account.
    if (!pendingRefreshes.has(uuid)) {
      const refresh = (async () => {
        let result;
        try {
          result = await fetchLabyHistory(currentProfile);
        } catch {
          const mayHaveHiddenHistory = cached?.history_empty === true
            || cached?.history.some((entry) => entry?.name === '-'
              || (cached.schema_version === 2 && entry?.censored === true));
          if (mayHaveHiddenHistory) {
            historyRetryAt.set(uuid, Date.now() + 60_000);
            return null;
          }
          try {
            result = await fetchCraftyHistory(currentProfile);
          } catch {
            historyRetryAt.set(uuid, Date.now() + 60_000);
            return null;
          }
        }
        const profile = buildProfileHistory({ query, currentProfile, result });
        // Replace only after a valid response. Never merge cached hidden names
        // into a provider's freshly returned (possibly deliberately empty) list.
        storage.indexProfile(profile);
        historyRetryAt.delete(uuid);
        return profile;
      })();
      pendingRefreshes.set(uuid, refresh);
      refresh.finally(() => pendingRefreshes.delete(uuid)).catch(() => {});
    }
    const refreshed = await pendingRefreshes.get(uuid);
    return refreshed ? cloneProfileWithQuery(refreshed, query, { current_name: currentProfile.name })
      : unavailableHistory(query, currentProfile, cached);
  }

  async function getByUsername(username, { forceRefresh = false } = {}) {
    if (!isValidUsername(username)) {
      throw createError(400, 'Enter a Minecraft username using 1–16 letters, numbers or underscores.');
    }
    const query = username.trim();
    // Names can be reassigned. Only Mojang determines the UUID for a name;
    // the persistent cache is used for history after this resolution succeeds.
    const currentProfile = await resolveCurrentProfileByUsername(query);
    if (!currentProfile) {
      throw createError(404, 'Player not found.');
    }
    return refreshByResolvedProfile(query, currentProfile, forceRefresh);
  }

  async function getByUuid(uuid, { forceRefresh = false, query = null } = {}) {
    if (!isValidUuid(uuid)) {
      throw createError(400, 'Enter a valid Minecraft UUID.');
    }
    const formattedUuid = formatUuid(uuid);
    const cached = storage.getProfileByUuid(formattedUuid);
    let currentProfile;
    try {
      currentProfile = await resolveCurrentProfileByUuid(formattedUuid);
    } catch (error) {
      // An explicit UUID remains unambiguous even while Mojang is unavailable.
      if (cached) {
        return cloneProfileWithQuery(cached, query || cached.current_name, {
          history_status: 'stale', profile_stale: true
        });
      }
      throw error;
    }
    if (!currentProfile) {
      throw createError(404, 'Player not found.');
    }
    return refreshByResolvedProfile(query || currentProfile.name, currentProfile, forceRefresh);
  }

  async function updateProfiles(payload) {
    const usernames = [];
    const uuids = [];

    if (payload?.username) {
      usernames.push(payload.username);
    }

    if (payload?.uuid) {
      uuids.push(payload.uuid);
    }

    if (Array.isArray(payload?.usernames)) {
      usernames.push(...payload.usernames);
    }

    if (Array.isArray(payload?.uuids)) {
      uuids.push(...payload.uuids);
    }

    const updated = [];
    const errors = [];

    for (const username of usernames) {
      try {
        updated.push(await getByUsername(String(username), { forceRefresh: true }));
      } catch (error) {
        errors.push({
          username: String(username),
          error: error?.body?.description || error.message || 'Unknown error'
        });
      }
    }

    for (const uuid of uuids) {
      try {
        updated.push(await getByUuid(String(uuid), { forceRefresh: true }));
      } catch (error) {
        errors.push({
          uuid: formatUuid(uuid),
          error: error?.body?.description || error.message || 'Unknown error'
        });
      }
    }

    return {
      updated,
      errors
    };
  }

  function deleteProfile({ username = null, uuid = null }) {
    if (username) {
      const existing = storage.deleteProfileByName(username);
      if (!existing) {
        throw createError(404, 'Profile not found');
      }

      return {
        message: 'Profile deleted',
        uuid: existing.uuid
      };
    }

    if (uuid) {
      const existing = storage.deleteProfileByUuid(uuid);
      if (!existing) {
        throw createError(404, 'Profile not found');
      }

      return {
        message: 'Profile deleted',
        uuid: existing.uuid
      };
    }

    throw createError(400, 'username or uuid required');
  }

  return {
    config,
    createError,
    getByUsername,
    getByUuid,
    updateProfiles,
    deleteProfile
  };
}

module.exports = {
  createNameHistoryApiService,
  formatUuid,
  isValidUsername,
  isValidUuid,
  normalizeName,
  normalizeUuid
};
