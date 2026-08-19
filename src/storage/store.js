const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EVENT_DEFINITIONS } = require('../features/eventCalendar');
const { MINING_EVENT_DEFINITIONS } = require('../features/miningEvents');

const DEFAULT_MOD_UPDATE_REPO_URL = 'https://github.com/odtheking/Odin';
const BRIDGE_EVENT_KEYS = EVENT_DEFINITIONS.map((definition) => definition.key);

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
    miningEvents: normalizeMiningEventConfig(config?.miningEvents),
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
    rolePanelChannelId: config?.rolePanelChannelId || null,
    roles: Object.fromEntries(
      EVENT_DEFINITIONS.map((definition) => [definition.key, config?.roles?.[definition.key] || null])
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
    miningEvents: normalizeMiningEventsRuntimeState(state?.miningEvents),
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

  const messageExpireAts = state?.messageExpireAts && typeof state.messageExpireAts === 'object'
    ? Object.fromEntries(
      Object.entries(state.messageExpireAts)
        .map(([eventKey, expireAt]) => [String(eventKey || '').trim(), expireAt == null ? null : Number(expireAt)])
        .filter(([eventKey]) => eventKey)
    )
    : {};

  return {
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
        .map(([eventKey, endsAt]) => [String(eventKey || '').trim(), Number(endsAt)])
        .filter(([eventKey, endsAt]) => eventKey && Number.isFinite(endsAt))
    )
    : {};

  const pingMessageIds = state?.pingMessageIds && typeof state.pingMessageIds === 'object'
    ? Object.fromEntries(
      Object.entries(state.pingMessageIds)
        .map(([eventKey, messageId]) => [String(eventKey || '').trim(), messageId ? String(messageId) : null])
        .filter(([eventKey, messageId]) => eventKey && messageId)
    )
    : {};

  return {
    activeEvents,
    pingMessageIds,
    pingChannelId: state?.pingChannelId ?? null,
    dashboardMessageId: state?.dashboardMessageId ?? null,
    oldPingsSwept: state?.oldPingsSwept === true,
    rolePanelChannelId: state?.rolePanelChannelId ?? null,
    dwarvenRolePanelMessageId: state?.dwarvenRolePanelMessageId ?? null,
    crystalRolePanelMessageId: state?.crystalRolePanelMessageId ?? null
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

function normalizeBridgeLinksState(state) {
  const users = state?.users && typeof state.users === 'object'
    ? Object.fromEntries(
      Object.entries(state.users)
        .map(([discordUserId, entry]) => [String(discordUserId || '').trim(), normalizeBridgeLinkedUser(entry)])
        .filter(([discordUserId]) => /^\d{16,20}$/.test(discordUserId))
    )
    : {};

  return {
    users,
    hypixelVerificationMigrationVersion: Number.isFinite(state?.hypixelVerificationMigrationVersion)
      ? Number(state.hypixelVerificationMigrationVersion)
      : 0
  };
}

function normalizeBridgeLinkedUser(entry) {
  const minecraftUsernames = normalizeMinecraftUsernameList(entry?.minecraftUsernames);
  const preferredMinecraftUsername = selectPreferredMinecraftUsername(
    minecraftUsernames,
    entry?.preferredMinecraftUsername
  );
  const hypixelVerifiedAt = Number.isFinite(entry?.hypixelVerifiedAt) ? Number(entry.hypixelVerifiedAt) : null;
  const requiresHypixelVerification = Boolean(entry?.requiresHypixelVerification ?? (
    minecraftUsernames.length > 0 && !hypixelVerifiedAt
  ));

  return {
    discordUsername: typeof entry?.discordUsername === 'string' ? entry.discordUsername.trim() : '',
    discordDisplayName: typeof entry?.discordDisplayName === 'string' ? entry.discordDisplayName.trim() : '',
    minecraftUsernames,
    preferredMinecraftUsername,
    pendingMinecraftUsernames: normalizeMinecraftUsernameList(entry?.pendingMinecraftUsernames),
    linkCode: typeof entry?.linkCode === 'string' ? entry.linkCode.trim().toUpperCase() : null,
    linkCodeExpiresAt: Number.isFinite(entry?.linkCodeExpiresAt) ? Number(entry.linkCodeExpiresAt) : null,
    linkedAt: Number.isFinite(entry?.linkedAt) ? Number(entry.linkedAt) : null,
    hypixelVerifiedAt,
    requiresHypixelVerification,
    eventPreferences: normalizeBridgeEventPreferences(entry?.eventPreferences)
  };
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

function normalizeHideonleafStatsState(state) {
  const users = state?.users && typeof state.users === 'object'
    ? Object.entries(state.users)
      .reduce((result, [storedKey, entry]) => {
        const normalizedEntry = normalizeHideonleafStatsEntry(entry);
        const normalizedKey = normalizeMinecraftUsername(normalizedEntry.minecraftUsername || storedKey);
        if (!normalizedKey) {
          return result;
        }

        const existingEntry = result[normalizedKey] || null;
        const existingUpdatedAt = Number.isFinite(existingEntry?.updatedAt) ? Number(existingEntry.updatedAt) : 0;
        const incomingUpdatedAt = Number.isFinite(normalizedEntry?.updatedAt) ? Number(normalizedEntry.updatedAt) : 0;
        if (!existingEntry || incomingUpdatedAt >= existingUpdatedAt) {
          result[normalizedKey] = {
            ...normalizedEntry,
            minecraftUsername: normalizedKey
          };
        }

        return result;
      }, {})
    : {};

  return { users };
}

function normalizeMobModelState(state) {
  const users = state?.users && typeof state.users === 'object'
    ? Object.entries(state.users)
      .reduce((result, [storedKey, entry]) => {
        const normalizedEntry = normalizeMobModelEntry(entry);
        const normalizedKey = normalizeMinecraftUsername(normalizedEntry.minecraftUsername || storedKey);
        if (!normalizedKey) {
          return result;
        }

        const existingEntry = result[normalizedKey] || null;
        const existingUpdatedAt = Number.isFinite(existingEntry?.updatedAt) ? Number(existingEntry.updatedAt) : 0;
        const incomingUpdatedAt = Number.isFinite(normalizedEntry?.updatedAt) ? Number(normalizedEntry.updatedAt) : 0;
        if (!existingEntry || incomingUpdatedAt >= existingUpdatedAt) {
          result[normalizedKey] = {
            ...normalizedEntry,
            minecraftUsername: normalizedKey
          };
        }

        return result;
      }, {})
    : {};

  return { users };
}

function normalizeMobModelEntry(entry) {
  return {
    minecraftUsername: normalizeMinecraftUsername(entry?.minecraftUsername),
    enabled: entry?.enabled === true,
    entityType: normalizeMobModelEntityType(entry?.entityType),
    baby: entry?.baby === true,
    updatedAt: Number.isFinite(entry?.updatedAt) ? Number(entry.updatedAt) : null
  };
}

function normalizeMobModelEntityType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return 'minecraft:zombie';
  }

  const namespaced = raw.includes(':') ? raw : `minecraft:${raw}`;
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(namespaced) ? namespaced : 'minecraft:zombie';
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

function normalizeHideonleafStatsEntry(entry) {
  return {
    minecraftUsername: normalizeMinecraftUsername(entry?.minecraftUsername),
    kills: Math.max(0, Number(entry?.kills) || 0),
    totalShards: Math.max(0, Number(entry?.totalShards) || 0),
    totalProfit: Math.max(0, Number(entry?.totalProfit) || 0),
    profitPerHour: Math.max(0, Number(entry?.profitPerHour) || 0),
    totalDurationMs: Math.max(0, Number(entry?.totalDurationMs) || 0),
    items: normalizeHideonleafItems(entry?.items),
    updatedAt: Number.isFinite(entry?.updatedAt) ? Number(entry.updatedAt) : null
  };
}

function normalizeHideonleafItems(items) {
  if (!items || typeof items !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(items)
      .map(([name, item]) => [String(name || '').trim(), normalizeHideonleafItemEntry(item)])
      .filter(([name]) => name)
  );
}

function normalizeHideonleafItemEntry(item) {
  return {
    amount: Math.max(0, Number(item?.amount) || 0),
    timesDropped: Math.max(0, Number(item?.timesDropped) || 0),
    pricePerUnit: Math.max(0, Number(item?.pricePerUnit) || 0)
  };
}

function normalizeBridgeEventPreferences(preferences) {
  return Object.fromEntries(BRIDGE_EVENT_KEYS.map((eventKey) => [eventKey, preferences?.[eventKey] !== false]));
}

function normalizeMinecraftUsernameList(values) {
  return Array.isArray(values)
    ? [...new Set(values
      .map((value) => normalizeMinecraftUsername(value))
      .filter(Boolean))]
    : [];
}

function normalizeMinecraftUsername(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9_]{3,16}$/.test(raw) ? raw : '';
}

function selectPreferredMinecraftUsername(usernames, preferredUsername) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return null;
  }

  const normalizedPreferred = normalizeMinecraftUsername(preferredUsername).toLowerCase();
  if (!normalizedPreferred) {
    return usernames[0];
  }

  return usernames.find((username) => username.toLowerCase() === normalizedPreferred) || usernames[0];
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
  migrateLegacyBridgeLinks();

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

  function migrateLegacyBridgeLinks() {
    const links = normalizeBridgeLinksState(guildState.links);
    if (links.hypixelVerificationMigrationVersion >= 1) {
      return;
    }

    const hasLegacyLinks = Object.values(links.users)
      .some((entry) => entry.requiresHypixelVerification && entry.minecraftUsernames.length > 0);
    if (!hasLegacyLinks) {
      return;
    }

    guildState = {
      ...guildState,
      links: {
        ...links,
        hypixelVerificationMigrationVersion: 1
      }
    };
    saveState();
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
        .filter(([, config]) => {
          const normalized = normalizeGuildConfig(config);
          return normalized.eventReminders.channelId || normalized.channelId;
        })
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
    getMiningEventConfiguredGuildIds() {
      return Object.entries(guildConfig.guilds)
        .filter(([, config]) => normalizeGuildConfig(config).miningEvents.channelId)
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
    },
    getBridgeLinkedAccount(discordUserId) {
      return normalizeBridgeLinksState(guildState.links).users[String(discordUserId || '').trim()] || null;
    },
    getPreferredBridgeMinecraftUsername(discordUserId) {
      const account = this.getBridgeLinkedAccount(discordUserId);
      if (account?.requiresHypixelVerification) {
        return null;
      }

      return account?.minecraftUsernames?.[0] || null;
    },
    setBridgeLinkedAccount(discordUserId, partialEntry) {
      const key = String(discordUserId || '').trim();
      const links = normalizeBridgeLinksState(guildState.links);
      guildState = {
        ...guildState,
        links: {
          ...links,
          users: {
            ...links.users,
            [key]: normalizeBridgeLinkedUser({
              ...links.users[key],
              ...partialEntry
            })
          }
        }
      };
      saveState();
      return this.getBridgeLinkedAccount(key);
    },
    removeBridgeLinkedAccount(discordUserId) {
      const key = String(discordUserId || '').trim();
      const links = normalizeBridgeLinksState(guildState.links);
      const nextUsers = { ...links.users };
      delete nextUsers[key];
      guildState = {
        ...guildState,
        links: {
          ...links,
          users: nextUsers
        }
      };
      saveState();
    },
    findBridgeLinkByMinecraftUsername(username, options = {}) {
      const normalizedUsername = normalizeMinecraftUsername(username).toLowerCase();
      if (!normalizedUsername) {
        return null;
      }

      const includeLegacy = options.includeLegacy === true;
      const links = normalizeBridgeLinksState(guildState.links);
      for (const [discordUserId, entry] of Object.entries(links.users)) {
        if (!includeLegacy && entry.requiresHypixelVerification) {
          continue;
        }

        if (entry.minecraftUsernames.some((value) => value.toLowerCase() === normalizedUsername)) {
          return { discordUserId, entry };
        }
      }

      return null;
    },
    startBridgeLink(discordUserId, minecraftUsernames) {
      const key = String(discordUserId || '').trim();
      const usernames = normalizeMinecraftUsernameList(minecraftUsernames);
      const conflicts = usernames.filter((username) => {
        const existing = this.findBridgeLinkByMinecraftUsername(username);
        return existing && existing.discordUserId !== key;
      });

      if (conflicts.length > 0) {
        return { ok: false, error: `These usernames are already linked: ${conflicts.join(', ')}` };
      }

      const account = this.setBridgeLinkedAccount(key, {
        ...this.getBridgeLinkedAccount(key),
        pendingMinecraftUsernames: usernames,
        linkCode: crypto.randomBytes(3).toString('hex').toUpperCase(),
        linkCodeExpiresAt: Date.now() + (10 * 60 * 1000),
        eventPreferences: this.getBridgeLinkedAccount(key)?.eventPreferences || normalizeBridgeEventPreferences()
      });

      return {
        ok: true,
        code: account.linkCode,
        expiresAt: account.linkCodeExpiresAt,
        pendingMinecraftUsernames: account.pendingMinecraftUsernames
      };
    },
    completeBridgeLink(code, minecraftUsername) {
      const normalizedCode = String(code || '').trim().toUpperCase();
      const normalizedUsername = normalizeMinecraftUsername(minecraftUsername);
      if (!normalizedCode || !normalizedUsername) {
        return { ok: false, error: 'Invalid link code or Minecraft username.' };
      }

      const links = normalizeBridgeLinksState(guildState.links);
      for (const [discordUserId, entry] of Object.entries(links.users)) {
        if (entry.linkCode !== normalizedCode || !entry.linkCodeExpiresAt || entry.linkCodeExpiresAt < Date.now()) {
          continue;
        }

        if (
          entry.pendingMinecraftUsernames.length > 0 &&
          !entry.pendingMinecraftUsernames.some((value) => value.toLowerCase() === normalizedUsername.toLowerCase())
        ) {
          return { ok: false, error: 'This Minecraft username is not in the pending link list.' };
        }

        const targetUsernames = normalizeMinecraftUsernameList([
          ...entry.minecraftUsernames,
          ...entry.pendingMinecraftUsernames,
          normalizedUsername
        ]);
        const conflicts = targetUsernames.filter((username) => {
          const existing = this.findBridgeLinkByMinecraftUsername(username);
          return existing && existing.discordUserId !== discordUserId;
        });

        if (conflicts.length > 0) {
          return { ok: false, error: `These usernames are already linked elsewhere: ${conflicts.join(', ')}` };
        }

        const updated = this.setBridgeLinkedAccount(discordUserId, {
          minecraftUsernames: targetUsernames,
          pendingMinecraftUsernames: [],
          linkCode: null,
          linkCodeExpiresAt: null,
          linkedAt: entry.linkedAt || Date.now(),
          eventPreferences: entry.eventPreferences
        });

        return { ok: true, discordUserId, account: updated };
      }

      return { ok: false, error: 'Link code not found or expired.' };
    },
    linkVerifiedBridgeMinecraftUsernames(discordUserId, minecraftUsernames, metadata = {}) {
      const key = String(discordUserId || '').trim();
      const account = this.getBridgeLinkedAccount(key);
      const usernames = normalizeMinecraftUsernameList(minecraftUsernames);
      if (usernames.length === 0) {
        return { ok: false, error: 'Add at least one valid Minecraft username.' };
      }

      const conflicts = usernames.filter((username) => {
        const existing = this.findBridgeLinkByMinecraftUsername(username, { includeLegacy: true });
        return existing && existing.discordUserId !== key && !existing.entry.requiresHypixelVerification;
      });

      if (conflicts.length > 0) {
        return { ok: false, error: `These usernames are already linked: ${conflicts.join(', ')}` };
      }

      for (const username of usernames) {
        const existing = this.findBridgeLinkByMinecraftUsername(username, { includeLegacy: true });
        if (existing && existing.discordUserId !== key && existing.entry.requiresHypixelVerification) {
          this.removeBridgeMinecraftUsername(existing.discordUserId, username);
        }
      }

      const existingUsernames = account?.requiresHypixelVerification
        ? []
        : (account?.minecraftUsernames || []);
      const verifiedAt = Date.now();
      const updated = this.setBridgeLinkedAccount(key, {
        ...metadata,
        minecraftUsernames: normalizeMinecraftUsernameList([
          ...existingUsernames,
          ...usernames
        ]),
        pendingMinecraftUsernames: [],
        linkCode: null,
        linkCodeExpiresAt: null,
        linkedAt: account?.linkedAt || Date.now(),
        hypixelVerifiedAt: verifiedAt,
        requiresHypixelVerification: false,
        eventPreferences: account?.eventPreferences || normalizeBridgeEventPreferences()
      });

      return { ok: true, account: updated, usernames };
    },
    removeBridgeMinecraftUsername(discordUserId, minecraftUsername) {
      const key = String(discordUserId || '').trim();
      const account = this.getBridgeLinkedAccount(key);
      if (!account || account.minecraftUsernames.length === 0) {
        return { ok: false, error: 'You are not linked yet.' };
      }

      const normalizedUsername = normalizeMinecraftUsername(minecraftUsername);
      const nextUsernames = account.minecraftUsernames.filter((value) => value.toLowerCase() !== normalizedUsername.toLowerCase());
      const updated = this.setBridgeLinkedAccount(key, { minecraftUsernames: nextUsernames });
      return { ok: true, account: updated };
    },
    setBridgeEventPreference(discordUserId, eventKey, enabled) {
      const key = String(discordUserId || '').trim();
      const account = this.getBridgeLinkedAccount(key);
      if (!account || account.minecraftUsernames.length === 0) {
        return { ok: false, error: 'You are not linked yet.' };
      }

      if (account.requiresHypixelVerification) {
        return { ok: false, error: `Re-verify your Minecraft link with \`/link username:${account.minecraftUsernames[0]}\` first.` };
      }

      if (!BRIDGE_EVENT_KEYS.includes(eventKey)) {
        return { ok: false, error: 'Unknown event key.' };
      }

      const updated = this.setBridgeLinkedAccount(key, {
        eventPreferences: {
          ...account.eventPreferences,
          [eventKey]: enabled !== false
        }
      });

      return { ok: true, account: updated };
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
    },
    getUserHideonleafStats(minecraftUsername) {
      const key = normalizeMinecraftUsername(minecraftUsername);
      if (!key) {
        return null;
      }

      return normalizeHideonleafStatsState(guildState.hideonleaf).users[key] || null;
    },
    setUserHideonleafStats(minecraftUsername, partialEntry) {
      const key = normalizeMinecraftUsername(minecraftUsername || partialEntry?.minecraftUsername);
      if (!key) {
        return null;
      }

      const hideonleaf = normalizeHideonleafStatsState(guildState.hideonleaf);
      const existingEntry = hideonleaf.users[key] || null;
      const incomingUpdatedAt = Number.isFinite(partialEntry?.updatedAt) ? Number(partialEntry.updatedAt) : Date.now();
      const existingUpdatedAt = Number.isFinite(existingEntry?.updatedAt) ? Number(existingEntry.updatedAt) : 0;
      if (existingEntry && incomingUpdatedAt < existingUpdatedAt) {
        return this.getUserHideonleafStats(key);
      }

      guildState = {
        ...guildState,
        hideonleaf: {
          users: {
            ...hideonleaf.users,
            [key]: normalizeHideonleafStatsEntry({
              ...existingEntry,
              ...partialEntry,
              minecraftUsername: key,
              updatedAt: incomingUpdatedAt
            })
          }
        }
      };
      saveState();
      return this.getUserHideonleafStats(key);
    },
    getUserMobModel(minecraftUsername) {
      const key = normalizeMinecraftUsername(minecraftUsername);
      if (!key) {
        return null;
      }

      return normalizeMobModelState(guildState.mobModels).users[key] || null;
    },
    setUserMobModel(minecraftUsername, partialEntry) {
      const key = normalizeMinecraftUsername(minecraftUsername || partialEntry?.minecraftUsername);
      if (!key) {
        return null;
      }

      const mobModels = normalizeMobModelState(guildState.mobModels);
      const existingEntry = mobModels.users[key] || null;
      const incomingUpdatedAt = Number.isFinite(partialEntry?.updatedAt) ? Number(partialEntry.updatedAt) : Date.now();
      const existingUpdatedAt = Number.isFinite(existingEntry?.updatedAt) ? Number(existingEntry.updatedAt) : 0;
      if (existingEntry && incomingUpdatedAt < existingUpdatedAt) {
        return this.getUserMobModel(key);
      }

      guildState = {
        ...guildState,
        mobModels: {
          users: {
            ...mobModels.users,
            [key]: normalizeMobModelEntry({
              ...existingEntry,
              ...partialEntry,
              minecraftUsername: key,
              updatedAt: incomingUpdatedAt
            })
          }
        }
      };
      saveState();
      return this.getUserMobModel(key);
    },
    listMobModels() {
      const mobModels = normalizeMobModelState(guildState.mobModels);
      return Object.entries(mobModels.users).map(([minecraftUsername, entry]) => ({
        minecraftUsername,
        ...entry
      }));
    },
    listHideonleafStats() {
      const hideonleaf = normalizeHideonleafStatsState(guildState.hideonleaf);
      return Object.entries(hideonleaf.users).map(([minecraftUsername, entry]) => ({
        minecraftUsername,
        ...entry
      }));
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
    return {
      guilds: {},
      links: normalizeBridgeLinksState(),
      farming: normalizeFarmingStatsState(),
      hideonleaf: normalizeHideonleafStatsState(),
      mobModels: normalizeMobModelState()
    };
  }

  if (state.guilds && typeof state.guilds === 'object') {
    return {
      ...state,
      links: normalizeBridgeLinksState(state.links),
      farming: normalizeFarmingStatsState(state.farming),
      hideonleaf: normalizeHideonleafStatsState(state.hideonleaf),
      mobModels: normalizeMobModelState(state.mobModels)
    };
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
    },
    links: normalizeBridgeLinksState(),
    farming: normalizeFarmingStatsState(),
    hideonleaf: normalizeHideonleafStatsState(),
    mobModels: normalizeMobModelState()
  };
}

function loadShitterData(shitterFilePath) {
  const data = loadJsonFile(shitterFilePath, { guilds: {} });
  return normalizeShitterStore(data);
}

module.exports = { createStore, normalizeGuildConfig };
