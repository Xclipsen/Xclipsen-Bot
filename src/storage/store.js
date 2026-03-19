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
    reactionRoles: Array.isArray(config?.reactionRoles)
      ? config.reactionRoles.map((entry) => ({
        channelId: entry?.channelId || null,
        messageId: entry?.messageId || null,
        roleId: entry?.roleId || null,
        emoji: entry?.emoji || null,
        requiredRoleId: entry?.requiredRoleId || null
      }))
      : []
    ,
    shitterEntries: Array.isArray(config?.shitterEntries)
      ? config.shitterEntries.map((entry) => ({
        ign: String(entry?.ign || '').trim(),
        normalizedIgn: String(entry?.normalizedIgn || entry?.ign || '').trim().toLowerCase(),
        reason: String(entry?.reason || '').trim(),
        createdAt: entry?.createdAt || null,
        screenshotUrl: entry?.screenshotUrl || null,
        screenshotName: entry?.screenshotName || null,
        addedByUserId: entry?.addedByUserId || null
      })).filter((entry) => entry.ign && entry.reason && entry.createdAt)
      : []
  };
}

function createStore({ configFilePath, stateFilePath }) {
  let guildConfig = loadConfig(configFilePath);
  let guildState = loadState(stateFilePath);

  function saveConfig() {
    saveJsonFile(configFilePath, guildConfig);
  }

  function saveState() {
    saveJsonFile(stateFilePath, guildState);
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
      return guildState.mock || { scenario: null, enabled: false };
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
      return this.getGuildConfig(guildId).shitterEntries;
    },
    setShitterEntries(guildId, shitterEntries) {
      this.setGuildConfig(guildId, { shitterEntries });
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

module.exports = { createStore, normalizeGuildConfig };
