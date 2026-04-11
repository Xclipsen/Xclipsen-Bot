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
  const state = readJsonFile(cacheFilePath, {
    profiles: {},
    nameIndex: {}
  });

  if (!state.profiles || typeof state.profiles !== 'object') {
    state.profiles = {};
  }

  if (!state.nameIndex || typeof state.nameIndex !== 'object') {
    state.nameIndex = {};
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

    const names = new Set([
      normalizeName(profile.query),
      normalizeName(profile.current_name),
      ...profile.history.map((entry) => normalizeName(entry.name))
    ]);

    for (const name of names) {
      if (name) {
        state.nameIndex[name] = uuid;
      }
    }

    save();
  }

  function getProfileByUuid(uuid) {
    return state.profiles[formatUuid(uuid)] || null;
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

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    text,
    headers: response.headers
  };
}

function createNameHistoryApiService(config) {
  const storage = createStorage(config.cacheFilePath);
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

  async function resolveCurrentProfileByUsername(username) {
    const encodedName = encodeURIComponent(username);
    const candidates = [
      `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodedName}`,
      `https://api.mojang.com/users/profiles/minecraft/${encodedName}`
    ];

    for (const url of candidates) {
      const timeout = createAbortSignal();
      try {
        const response = await fetchJson(url, {
          headers: defaultHeaders,
          signal: timeout.signal
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 204) {
            continue;
          }

          throw new Error(`Profile lookup failed with status ${response.status}.`);
        }

        if (response.data?.id && response.data?.name) {
          return {
            uuid: formatUuid(response.data.id),
            name: String(response.data.name)
          };
        }
      } finally {
        timeout.dispose();
      }
    }

    return null;
  }

  async function resolveCurrentProfileByUuid(uuid) {
    const compactUuid = normalizeUuid(uuid);
    const candidates = [
      `https://sessionserver.mojang.com/session/minecraft/profile/${compactUuid}`,
      `https://api.mojang.com/user/profile/${compactUuid}`
    ];

    for (const url of candidates) {
      const timeout = createAbortSignal();
      try {
        const response = await fetchJson(url, {
          headers: defaultHeaders,
          signal: timeout.signal
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 204) {
            continue;
          }

          throw new Error(`UUID lookup failed with status ${response.status}.`);
        }

        if (response.data?.id && response.data?.name) {
          return {
            uuid: formatUuid(response.data.id),
            name: String(response.data.name)
          };
        }
      } finally {
        timeout.dispose();
      }
    }

    return null;
  }

  function parseLabyProfilePage(html) {
    const uuidMatch = String(html).match(/window\.uuid = '([0-9a-fA-F-]{32,36})';/);
    const usernameMatch = String(html).match(/window\.username = '([^']+)';/);

    if (!uuidMatch || !usernameMatch) {
      return null;
    }

    return {
      uuid: formatUuid(uuidMatch[1]),
      name: usernameMatch[1]
    };
  }

  async function resolveProfileViaLabyPage(username) {
    if (!config.enableLabyFallback) {
      return null;
    }

    const timeout = createAbortSignal();
    try {
      const response = await fetchText(`https://laby.net/@${encodeURIComponent(username)}`, {
        headers: defaultHeaders,
        signal: timeout.signal
      });

      if (!response.ok) {
        return null;
      }

      return parseLabyProfilePage(response.text);
    } finally {
      timeout.dispose();
    }
  }

  async function fetchLabySnippet(uuid) {
    const timeout = createAbortSignal();
    try {
      const response = await fetchJson(`https://laby.net/api/v3/user/${formatUuid(uuid)}/snippet`, {
        headers: defaultHeaders,
        signal: timeout.signal
      });

      if (!response.ok || !response.data?.user?.uuid) {
        return null;
      }

      return response.data;
    } finally {
      timeout.dispose();
    }
  }

  function normalizeTimestamp(value, fallback = null) {
    if (!value) {
      return fallback;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return fallback;
    }

    return date.toISOString();
  }

  function buildProfileHistory({ query, currentProfile, snippet }) {
    const nowIso = new Date().toISOString();
    const rawHistory = Array.isArray(snippet?.name_history) ? snippet.name_history : [];
    const seen = new Set();
    const history = [];

    for (const entry of rawHistory) {
      const name = String(entry?.name || '').trim();
      if (!name) {
        continue;
      }

      const normalized = normalizeName(name);
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      history.push({
        name,
        changed_at: normalizeTimestamp(entry?.changed_at),
        observed_at: normalizeTimestamp(entry?.last_seen_at, nowIso),
        censored: name === '-' || entry?.accurate === false
      });
    }

    if (history.length === 0 && currentProfile?.name) {
      history.push({
        name: currentProfile.name,
        changed_at: null,
        observed_at: nowIso,
        censored: false
      });
    }

    history.sort((left, right) => {
      const leftScore = left.changed_at ? new Date(left.changed_at).getTime() : Number.NEGATIVE_INFINITY;
      const rightScore = right.changed_at ? new Date(right.changed_at).getTime() : Number.NEGATIVE_INFINITY;
      return leftScore - rightScore;
    });

    const withIds = history.map((entry, index) => ({
      id: index + 1,
      ...entry
    }));

    const lastSeenAt = withIds.reduce((latest, entry) => {
      const currentValue = new Date(entry.observed_at).getTime();
      return currentValue > latest ? currentValue : latest;
    }, 0);

    return {
      query,
      uuid: formatUuid(currentProfile.uuid),
      current_name: currentProfile.name,
      last_seen_at: lastSeenAt > 0 ? new Date(lastSeenAt).toISOString() : nowIso,
      history: withIds
    };
  }

  function isStale(profile) {
    if (!profile?.last_seen_at) {
      return true;
    }

    const ageMs = Date.now() - new Date(profile.last_seen_at).getTime();
    return ageMs > config.staleMinutes * 60_000;
  }

  function cloneProfileWithQuery(profile, query) {
    return {
      query,
      uuid: profile.uuid,
      current_name: profile.current_name,
      last_seen_at: profile.last_seen_at,
      history: profile.history.map((entry) => ({ ...entry }))
    };
  }

  async function refreshByResolvedProfile(query, currentProfile) {
    const snippet = await fetchLabySnippet(currentProfile.uuid);
    const profile = buildProfileHistory({ query, currentProfile, snippet });
    storage.indexProfile(profile);
    return cloneProfileWithQuery(profile, query);
  }

  async function getByUsername(username, { forceRefresh = false } = {}) {
    if (!isValidUsername(username)) {
      throw createError(400, 'username required');
    }

    const normalizedQuery = normalizeName(username);
    const cached = storage.getProfileByName(normalizedQuery);
    if (cached && !forceRefresh && !isStale(cached)) {
      return cloneProfileWithQuery(cached, username);
    }

    const currentProfile =
      (await resolveCurrentProfileByUsername(username))
      || (await resolveProfileViaLabyPage(username))
      || (cached ? { uuid: cached.uuid, name: cached.current_name } : null);

    if (!currentProfile) {
      throw createError(404, 'Username not found');
    }

    return refreshByResolvedProfile(username, currentProfile);
  }

  async function getByUuid(uuid, { forceRefresh = false, query = null } = {}) {
    if (!isValidUuid(uuid)) {
      throw createError(400, 'uuid required');
    }

    const formattedUuid = formatUuid(uuid);
    const cached = storage.getProfileByUuid(formattedUuid);
    if (cached && !forceRefresh && !isStale(cached)) {
      return cloneProfileWithQuery(cached, query || cached.query || cached.current_name);
    }

    const currentProfile =
      (await resolveCurrentProfileByUuid(formattedUuid))
      || (cached ? { uuid: cached.uuid, name: cached.current_name } : null);

    if (!currentProfile) {
      throw createError(404, 'UUID not found');
    }

    return refreshByResolvedProfile(query || currentProfile.name, currentProfile);
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
