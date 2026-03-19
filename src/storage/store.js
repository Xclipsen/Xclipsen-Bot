const fs = require('node:fs');
const path = require('node:path');

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

function normalizeSnowflakeList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))]
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
      screenshotUrl: entry?.screenshotUrl || null,
      screenshotName: entry?.screenshotName || null,
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
      return guildState.guilds[guildId] || {
        boothOpen: null,
        alertMessageId: null,
        alertChannelId: null,
        statusMessageId: null,
        statusChannelId: null
      };
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
