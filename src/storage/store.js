const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MOD_UPDATE_REPO_URL = 'https://github.com/odtheking/Odin';

function loadJsonFile(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function saveJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeGuildConfig(config) {
  return {
    channelId: config?.channelId || null,
    roleId: config?.roleId || null,
    mayorAlerts: normalizeMayorAlertConfig(config?.mayorAlerts),
    eventReminders: normalizeEventReminderConfig(config?.eventReminders),
    cakeReminder: normalizeCakeReminderConfig(config?.cakeReminder),
    cultReminder: normalizeCultReminderConfig(config?.cultReminder),
    modUpdates: normalizeModUpdateConfig(config?.modUpdates),
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
    roles: {
      spookyFestival: config?.roles?.spookyFestival || null,
      travelingZoo: config?.roles?.travelingZoo || null,
      hoppitysHunt: config?.roles?.hoppitysHunt || null,
      seasonOfJerry: config?.roles?.seasonOfJerry || null,
      darkAuction: config?.roles?.darkAuction || null,
      cakeReminder: config?.roles?.cakeReminder || null,
      cultReminder: config?.roles?.cultReminder || null
    }
  };
}

function normalizeCakeReminderConfig(config) {
  return {
    channelId: config?.channelId || null,
    roleId: config?.roleId || null
  };
}

function normalizeCultReminderConfig(config) {
  return {
    channelId: config?.channelId || null,
    roleId: config?.roleId || null
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
    cakeReminder: normalizeCakeReminderRuntimeState(state?.cakeReminder),
    cultReminder: normalizeCultReminderRuntimeState(state?.cultReminder)
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

  return {
    lastSentStarts,
    messageIds,
    channelId: state?.channelId ?? null
  };
}

function normalizeCakeReminderRuntimeState(state) {
  return {
    lastSentWindowStart: state?.lastSentWindowStart ?? null,
    messageId: state?.messageId ?? null,
    channelId: state?.channelId ?? null
  };
}

function normalizeCultReminderRuntimeState(state) {
  return {
    lastSentWindowStart: state?.lastSentWindowStart ?? null,
    messageId: state?.messageId ?? null,
    channelId: state?.channelId ?? null
  };
}

function normalizeSnowflakeList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))]
    : [];
}

function normalizeScreenshotEntries(entry) {
  const screenshots = Array.isArray(entry?.screenshots)
    ? entry.screenshots.map((screenshot) => ({
        url: screenshot?.url || null,
        name: screenshot?.name || null
      }))
    : [];

  if (screenshots.length === 0 && entry?.screenshotUrl) {
    screenshots.push({
      url: entry.screenshotUrl,
      name: entry?.screenshotName || null
    });
  }

  return screenshots.filter((screenshot) => typeof screenshot.url === 'string' && screenshot.url.trim());
}

function normalizeShitterEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => {
      const screenshots = normalizeScreenshotEntries(entry);

      return {
        ign: String(entry?.ign || '').trim(),
        normalizedIgn: String(entry?.normalizedIgn || entry?.ign || '').trim().toLowerCase(),
        reason: String(entry?.reason || '').trim(),
        createdAt: entry?.createdAt || null,
        removedAt: entry?.removedAt || null,
        screenshotUrl: screenshots[0]?.url || null,
        screenshotName: screenshots[0]?.name || null,
        screenshots,
        addedByUserId: entry?.addedByUserId || null,
        removedByUserId: entry?.removedByUserId || null
      };
    }).filter((entry) => entry.ign && entry.reason && entry.createdAt)
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

  migrateLegacyShitterEntries();

  function saveConfig() {
    saveJsonFile(configFilePath, guildConfig);
  }

  function saveState() {
    saveJsonFile(stateFilePath, guildState);
  }

  function saveShitterData() {
    saveJsonFile(shitterFilePath, shitterData);
  }

  function migrateLegacyShitterEntries() {
    let migrated = false;
    const nextGuilds = { ...guildConfig.guilds };

    for (const [guildId, config] of Object.entries(guildConfig.guilds)) {
      const legacyEntries = normalizeShitterEntries(config?.shitterEntries);
      if (legacyEntries.length === 0) {
        continue;
      }

      shitterData = {
        ...shitterData,
        guilds: {
          ...shitterData.guilds,
          [guildId]: legacyEntries
        }
      };

      const { shitterEntries, ...rest } = config || {};
      nextGuilds[guildId] = rest;
      migrated = true;
    }

    if (migrated) {
      guildConfig = { ...guildConfig, guilds: nextGuilds };
      saveConfig();
      saveShitterData();
    }
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
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).channelId)
        .map(([guildId]) => guildId);
    },
    getModUpdateConfiguredGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => {
          const normalized = normalizeGuildConfig(config);
          return normalized.modUpdates.channelId && normalized.modUpdates.trackedRepos.length > 0;
        })
        .map(([guildId]) => guildId);
    },
    getModUpdateChannelGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).modUpdates.channelId)
        .map(([guildId]) => guildId);
    },
    getEventReminderConfiguredGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).eventReminders.channelId)
        .map(([guildId]) => guildId);
    },
    getCakeReminderConfiguredGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).cakeReminder.channelId)
        .map(([guildId]) => guildId);
    },
    getCultReminderConfiguredGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).cultReminder.channelId)
        .map(([guildId]) => guildId);
    }
  };
}

function loadConfig(configFilePath) {
  const config = loadJsonFile(configFilePath, { guilds: {} });
  return { guilds: config.guilds && typeof config.guilds === 'object' ? config.guilds : {} };
}

function loadState(stateFilePath) {
  const state = loadJsonFile(stateFilePath, null);

  if (!state) {
    return { guilds: {} };
  }

  if (state.guilds && typeof state.guilds === 'object') {
    return state;
  }

  return {
    guilds: {
      legacy: {
        boothOpen: state.boothOpen ?? null,
        alertMessageId: state.alertMessageId ?? null,
        alertChannelId: state.alertChannelId ?? null,
        statusMessageId: state.statusMessageId ?? null,
        statusChannelId: state.statusChannelId ?? null
      }
    }
  };
}

function loadShitterData(shitterFilePath) {
  const data = loadJsonFile(shitterFilePath, { guilds: {} });
  return normalizeShitterStore(data);
}

module.exports = { createStore, normalizeGuildConfig };
