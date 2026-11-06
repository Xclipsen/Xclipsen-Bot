const fs = require('node:fs');
const path = require('node:path');
const { EVENT_CATALOG, FEAST_EVENT_KEYS } = require('../config/eventDefinitions');
const { MINING_EVENT_DEFINITIONS } = require('../config/miningEventDefinitions');
const { WEATHER_ROLE_DEFINITIONS } = require('../config/weatherDefinitions');

const DEFAULT_MOD_UPDATE_REPO_URL = 'https://github.com/odtheking/Odin';

// Only a missing file falls back; unreadable or corrupt data must stop the bot instead of being overwritten.
function loadJsonFile(filePath, fallbackValue) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallbackValue;
    }
    throw new Error(`Could not read ${filePath}: ${error.message}`, { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Refusing to start: ${filePath} is not valid JSON (${error.message}).`, { cause: error });
  }
}

// Writes to a temp file in the same directory and renames it, so a crash never leaves a half-written file.
function saveJsonFile(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeFileSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function normalizeGuildConfig(config) {
  return {
    botManagers: {
      userIds: normalizeSnowflakeList(config?.botManagers?.userIds),
      roleIds: normalizeSnowflakeList(config?.botManagers?.roleIds)
    },
    channelId: config?.channelId || null,
    roleId: config?.roleId || null,
    mayorAlerts: normalizeMayorAlertConfig(config?.mayorAlerts),
    eventReminders: normalizeEventReminderConfig(config?.eventReminders),
    miningEvents: normalizeMiningEventConfig(config?.miningEvents),
    weather: normalizeWeatherConfig(config?.weather),
    modUpdates: normalizeModUpdateConfig(config?.modUpdates),
    tts: {
      roleId: config?.tts?.roleId || null,
      voice: config?.tts?.voice || null
    },
    shitterPermissions: {
      blockedUserIds: normalizeSnowflakeList(config?.shitterPermissions?.blockedUserIds),
      blockedRoleIds: normalizeSnowflakeList(config?.shitterPermissions?.blockedRoleIds),
      allowedRoleIds: normalizeSnowflakeList(config?.shitterPermissions?.allowedRoleIds)
    },
    reactionRoles: Array.isArray(config?.reactionRoles)
      ? config.reactionRoles.map((entry) => ({
        channelId: entry?.channelId || null,
        messageId: entry?.messageId || null,
        roleId: entry?.roleId || null,
        emoji: entry?.emoji || null,
        requiredRoleId: entry?.requiredRoleId || null
      }))
      : []
  };
}

function normalizeMayorAlertConfig(config) {
  return {
    pingElectionOpen: config?.pingElectionOpen !== false,
    pingMayorChange: config?.pingMayorChange !== false
  };
}

function normalizeEventReminderConfig(config) {
  return {
    channelId: config?.channelId || null,
    roles: Object.fromEntries(
      EVENT_CATALOG.map((definition) => [definition.key, config?.roles?.[definition.key] || null])
    )
  };
}

function normalizeMiningEventConfig(config) {
  return {
    channelId: config?.channelId || null,
    roles: Object.fromEntries(
      MINING_EVENT_DEFINITIONS.map((definition) => [definition.key, config?.roles?.[definition.key] || null])
    )
  };
}

function normalizeWeatherConfig(config) {
  return {
    channelId: config?.channelId || null,
    roles: Object.fromEntries(
      WEATHER_ROLE_DEFINITIONS.map((definition) => [definition.key, config?.roles?.[definition.key] || null])
    )
  };
}

function normalizeModUpdateConfig(config) {
  const trackedRepos = Array.isArray(config?.trackedRepos)
    ? normalizeGitHubRepoList(config.trackedRepos)
    : [DEFAULT_MOD_UPDATE_REPO_URL];

  return {
    channelId: config?.channelId || null,
    roleId: config?.roleId || null,
    trackedRepos
  };
}

function normalizeGitHubRepoList(values) {
  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeGuildRuntimeState(state) {
  return {
    boothOpen: state?.boothOpen ?? null,
    alertMessageId: state?.alertMessageId ?? null,
    alertChannelId: state?.alertChannelId ?? null,
    statusMessageId: state?.statusMessageId ?? null,
    statusChannelId: state?.statusChannelId ?? null,
    modUpdates: normalizeModUpdateRuntimeState(state?.modUpdates),
    eventReminders: normalizeEventReminderRuntimeState(state?.eventReminders),
    miningEvents: normalizeMiningEventsRuntimeState(state?.miningEvents),
    weather: normalizeWeatherRuntimeState(state?.weather)
  };
}

function normalizeModUpdateRuntimeState(state) {
  const lastSeenReleases = state?.lastSeenReleases && typeof state.lastSeenReleases === 'object'
    ? Object.fromEntries(
      Object.entries(state.lastSeenReleases)
        .map(([repo, releaseId]) => [String(repo || '').trim(), releaseId == null ? null : String(releaseId)])
        .filter(([repo]) => repo)
    )
    : {};

  return {
    lastSeenReleases,
    statusMessageId: state?.statusMessageId ?? null,
    statusChannelId: state?.statusChannelId ?? null,
    alertMessageId: state?.alertMessageId ?? null,
    alertChannelId: state?.alertChannelId ?? null
  };
}

function normalizeEventReminderRuntimeState(state) {
  const lastSentStarts = state?.lastSentStarts && typeof state.lastSentStarts === 'object'
    ? Object.fromEntries(
      Object.entries(state.lastSentStarts)
        .map(([eventKey, windowStart]) => [String(eventKey || '').trim(), windowStart == null ? null : Number(windowStart)])
        .filter(([eventKey]) => eventKey)
    )
    : {};

  const messageIds = state?.messageIds && typeof state.messageIds === 'object'
    ? Object.fromEntries(
      Object.entries(state.messageIds)
        .map(([eventKey, messageId]) => [String(eventKey || '').trim(), messageId == null ? null : String(messageId)])
        .filter(([eventKey]) => eventKey)
    )
    : {};

  const messageExpireAts = state?.messageExpireAts && typeof state.messageExpireAts === 'object'
    ? Object.fromEntries(
      Object.entries(state.messageExpireAts)
        .map(([eventKey, expireAt]) => [String(eventKey || '').trim(), expireAt == null ? null : Number(expireAt)])
        .filter(([eventKey]) => eventKey)
    )
    : {};

  return {
    feastRotations: Object.fromEntries(FEAST_EVENT_KEYS.filter(key => typeof state?.feastRotations?.[key]?.signature === 'string' && Number.isFinite(state.feastRotations[key].windowStartAt)).map(key => [key, { signature: state.feastRotations[key].signature, windowStartAt: state.feastRotations[key].windowStartAt }])),
    lastSentStarts,
    messageIds,
    messageExpireAts,
    channelId: state?.channelId ?? null,
    rolePanelMessageId: state?.rolePanelMessageId ?? null,
    rolePanelChannelId: state?.rolePanelChannelId ?? null
  };
}

function normalizeMiningEventsRuntimeState(state) {
  const activeEvents = state?.activeEvents && typeof state.activeEvents === 'object'
    ? Object.fromEntries(
      Object.entries(state.activeEvents)
        .map(([eventKey, lastSeenAt]) => [String(eventKey || '').trim(), Number(lastSeenAt)])
        .filter(([eventKey, lastSeenAt]) => eventKey && Number.isFinite(lastSeenAt))
    )
    : {};

  const pingMessageIds = state?.pingMessageIds && typeof state.pingMessageIds === 'object'
    ? Object.fromEntries(
      Object.entries(state.pingMessageIds)
        .map(([eventKey, messageId]) => [String(eventKey || '').trim(), messageId ? String(messageId) : null])
        .filter(([eventKey, messageId]) => eventKey && messageId)
    )
    : {};

  const doublePingStates = state?.doublePingStates && typeof state.doublePingStates === 'object'
    ? Object.fromEntries(
      Object.entries(state.doublePingStates)
        .map(([eventKey, doublePingState]) => [String(eventKey || '').trim(), {
          dueAt: Number(doublePingState?.dueAt),
          handled: doublePingState?.handled === true
        }])
        .filter(([eventKey, doublePingState]) => eventKey && Number.isFinite(doublePingState.dueAt))
    )
    : {};

  return {
    activeEvents,
    doublePingStates,
    pingMessageIds,
    pingChannelId: state?.pingChannelId ?? null,
    dashboardMessageId: state?.dashboardMessageId ?? null,
    rolePanelChannelId: state?.rolePanelChannelId ?? null,
    dwarvenRolePanelMessageId: state?.dwarvenRolePanelMessageId ?? null,
    crystalRolePanelMessageId: state?.crystalRolePanelMessageId ?? null
  };
}

function normalizeWeatherRuntimeState(state) {
  return {
    channelId: state?.channelId ?? null,
    dashboardMessageId: state?.dashboardMessageId ?? null,
    dashboardStateKey: state?.dashboardStateKey ?? null,
    lastSentStarts: normalizeWeatherTierValues(state?.lastSentStarts, normalizeOptionalTimestamp),
    pingMessageIds: normalizeWeatherTierValues(state?.pingMessageIds, (messageId) => (messageId ? String(messageId) : null)),
    pingExpireAts: normalizeWeatherTierValues(state?.pingExpireAts, normalizeOptionalTimestamp),
    rolePanelMessageId: state?.rolePanelMessageId ?? null,
    rolePanelChannelId: state?.rolePanelChannelId ?? null
  };
}

function normalizeWeatherTierValues(values, normalizeValue) {
  return Object.fromEntries(
    WEATHER_ROLE_DEFINITIONS.map((definition) => [definition.key, normalizeValue(values?.[definition.key])])
  );
}

function normalizeOptionalTimestamp(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function normalizeFarmingStatsState(state) {
  const users = state?.users && typeof state.users === 'object'
    ? Object.fromEntries(
      Object.entries(state.users)
        .map(([discordUserId, entry]) => [String(discordUserId || '').trim(), normalizeFarmingStatsEntry(entry)])
        .filter(([discordUserId]) => /^\d{16,20}$/.test(discordUserId))
    )
    : {};

  return { users };
}

function normalizeFarmingStatsEntry(entry) {
  return {
    bonusPestChance: Math.max(0, Number(entry?.bonusPestChance) || 0),
    pestShardLevel: Math.min(10, Math.max(0, Number(entry?.pestShardLevel) || 0)),
    cropeetleLevel: Math.min(10, Math.max(0, Number(entry?.cropeetleLevel) || 0)),
    rarefinderLevel: Math.min(20, Math.max(0, Number(entry?.rarefinderLevel) || 0)),
    reforge: ['blessed', 'bountiful'].includes(String(entry?.reforge || '').trim().toLowerCase())
      ? String(entry.reforge).trim().toLowerCase()
      : null,
    lastPestFarmingProfits: normalizeLastPestFarmingProfitsEntry(entry?.lastPestFarmingProfits),
    updatedAt: Number.isFinite(entry?.updatedAt) ? Number(entry.updatedAt) : null
  };
}

function normalizeLastPestFarmingProfitsEntry(entry) {
  return {
    bait: typeof entry?.bait === 'string' ? entry.bait.trim() : null,
    vinyl: typeof entry?.vinyl === 'string' ? entry.vinyl.trim() : null,
    crop: typeof entry?.crop === 'string' ? entry.crop.trim() : null,
    fortune: Math.max(0, Number(entry?.fortune) || 0),
    pestFortune: Math.max(0, Number(entry?.pestFortune) || 0),
    plots: Math.max(1, Number(entry?.plots) || 1),
    sellMethod: typeof entry?.sellMethod === 'string' ? entry.sellMethod.trim() : null,
    updatedAt: Number.isFinite(entry?.updatedAt) ? Number(entry.updatedAt) : null
  };
}

function normalizeSnowflakeList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))]
    : [];
}

function normalizeScreenshotEntries(entry) {
  return Array.isArray(entry?.screenshots)
    ? entry.screenshots
      .map((screenshot) => ({ url: screenshot?.url || null, name: screenshot?.name || null }))
      .filter((screenshot) => typeof screenshot.url === 'string' && screenshot.url.trim())
    : [];
}

function normalizeShitterEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
      ign: String(entry?.ign || '').trim(),
      normalizedIgn: String(entry?.normalizedIgn || entry?.ign || '').trim().toLowerCase(),
      reason: String(entry?.reason || '').trim(),
      createdAt: entry?.createdAt || null,
      removedAt: entry?.removedAt || null,
      screenshots: normalizeScreenshotEntries(entry),
      addedByUserId: entry?.addedByUserId || null,
      removedByUserId: entry?.removedByUserId || null
    })).filter((entry) => entry.ign && entry.reason && entry.createdAt)
    : [];
}

function normalizeShitterStore(data) {
  const guilds = data?.guilds && typeof data.guilds === 'object' ? data.guilds : {};

  return {
    guilds: Object.fromEntries(
      Object.entries(guilds).map(([guildId, entries]) => [guildId, normalizeShitterEntries(entries)])
    )
  };
}

function createStore({ configFilePath, shitterFilePath, stateFilePath }) {
  let guildConfig = loadConfig(configFilePath);
  let shitterData = loadShitterData(shitterFilePath);
  let guildState = loadState(stateFilePath);

  function saveConfig() {
    saveJsonFile(configFilePath, guildConfig);
  }

  function saveState() {
    saveJsonFile(stateFilePath, guildState);
  }

  function saveShitterData() {
    saveJsonFile(shitterFilePath, shitterData);
  }

  function getGuildIdsWhere(predicate) {
    return Object.entries(guildConfig.guilds)
      .filter(([, config]) => predicate(normalizeGuildConfig(config)))
      .map(([guildId]) => guildId);
  }

  return {
    getGuildConfig(guildId) {
      return normalizeGuildConfig(guildConfig.guilds[guildId]);
    },
    setGuildConfig(guildId, partialConfig) {
      guildConfig = {
        ...guildConfig,
        guilds: {
          ...guildConfig.guilds,
          [guildId]: {
            ...normalizeGuildConfig(guildConfig.guilds[guildId]),
            ...partialConfig
          }
        }
      };
      saveConfig();
    },
    getGuildRuntimeState(guildId) {
      return normalizeGuildRuntimeState(guildState.guilds[guildId]);
    },
    setGuildRuntimeState(guildId, partialState) {
      guildState = {
        ...guildState,
        guilds: {
          ...guildState.guilds,
          [guildId]: {
            ...this.getGuildRuntimeState(guildId),
            ...partialState
          }
        }
      };
      saveState();
    },
    // Merges `patch` (or patch(latestSection)) into one runtime section such as 'miningEvents'.
    updateGuildRuntimeSection(guildId, section, patch) {
      const latest = this.getGuildRuntimeState(guildId)[section];
      this.setGuildRuntimeState(guildId, {
        [section]: {
          ...latest,
          ...(typeof patch === 'function' ? patch(latest) : patch)
        }
      });
    },
    getMockState() {
      return {
        enabled: Boolean(guildState.mock?.enabled),
        customData: guildState.mock?.customData || null
      };
    },
    setMockState(partialState) {
      guildState = {
        ...guildState,
        mock: {
          ...this.getMockState(),
          ...partialState
        }
      };
      saveState();
    },
    // Last Perkpocalypse order read from the wiki; validated by the jerryRotation feature.
    getJerryRotationCache() {
      return guildState.jerryRotation && typeof guildState.jerryRotation === 'object'
        ? guildState.jerryRotation
        : null;
    },
    setJerryRotationCache(rotation) {
      guildState = {
        ...guildState,
        jerryRotation: rotation || null
      };
      saveState();
    },
    getReactionRoleEntries(guildId) {
      return this.getGuildConfig(guildId).reactionRoles;
    },
    setReactionRoleEntries(guildId, reactionRoles) {
      this.setGuildConfig(guildId, { reactionRoles });
    },
    getShitterEntries(guildId) {
      return normalizeShitterEntries(shitterData.guilds[guildId]);
    },
    setShitterEntries(guildId, shitterEntries) {
      shitterData = {
        ...shitterData,
        guilds: {
          ...shitterData.guilds,
          [guildId]: normalizeShitterEntries(shitterEntries)
        }
      };
      saveShitterData();
    },
    getConfiguredGuildIds() {
      return getGuildIdsWhere((config) => config.eventReminders.channelId || config.channelId);
    },
    getModUpdateConfiguredGuildIds() {
      return getGuildIdsWhere((config) => config.modUpdates.channelId && config.modUpdates.trackedRepos.length > 0);
    },
    getEventReminderConfiguredGuildIds() {
      return getGuildIdsWhere((config) => config.eventReminders.channelId);
    },
    getMiningEventConfiguredGuildIds() {
      return getGuildIdsWhere((config) => config.miningEvents.channelId);
    },
    getWeatherConfiguredGuildIds() {
      return getGuildIdsWhere((config) => config.weather.channelId);
    },
    getUserFarmingStats(discordUserId) {
      return normalizeFarmingStatsState(guildState.farming).users[String(discordUserId || '').trim()] || null;
    },
    setUserFarmingStats(discordUserId, partialEntry) {
      const key = String(discordUserId || '').trim();
      const farming = normalizeFarmingStatsState(guildState.farming);
      guildState = {
        ...guildState,
        farming: {
          users: {
            ...farming.users,
            [key]: normalizeFarmingStatsEntry({
              ...farming.users[key],
              ...partialEntry,
              updatedAt: Date.now()
            })
          }
        }
      };
      saveState();
      return this.getUserFarmingStats(key);
    },
    getUserLastPestFarmingProfits(discordUserId) {
      return this.getUserFarmingStats(discordUserId)?.lastPestFarmingProfits || null;
    },
    setUserLastPestFarmingProfits(discordUserId, partialEntry) {
      const key = String(discordUserId || '').trim();
      const current = this.getUserFarmingStats(key) || {};
      return this.setUserFarmingStats(key, {
        ...current,
        lastPestFarmingProfits: {
          ...current.lastPestFarmingProfits,
          ...partialEntry,
          updatedAt: Date.now()
        }
      });
    }
  };
}

function loadConfig(configFilePath) {
  const config = loadJsonFile(configFilePath, { guilds: {} });
  return { guilds: config?.guilds && typeof config.guilds === 'object' ? config.guilds : {} };
}

// Unknown top-level keys (e.g. retired local links) are kept untouched on save.
function loadState(stateFilePath) {
  const state = loadJsonFile(stateFilePath, null) || {};
  return {
    ...state,
    guilds: state.guilds && typeof state.guilds === 'object' ? state.guilds : {},
    farming: normalizeFarmingStatsState(state.farming)
  };
}

function loadShitterData(shitterFilePath) {
  const data = loadJsonFile(shitterFilePath, { guilds: {} });
  return normalizeShitterStore(data);
}

module.exports = { createStore, normalizeGuildConfig };
