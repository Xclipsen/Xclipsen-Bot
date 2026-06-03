function createModBackendClient(env) {
  const baseUrl = String(env.MOD_BACKEND_URL || '').replace(/\/+$/, '');
  const authToken = String(env.MOD_BACKEND_AUTH_TOKEN || '');

  async function request(path, options = {}) {
    if (!baseUrl || !authToken) {
      throw new Error('Mod backend URL or auth token is not configured.');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Mod backend returned HTTP ${response.status}`);
    }

    return payload;
  }

  async function getBridgeLinkedAccount(discordUserId) {
    const payload = await request(`/api/bot/links?discordUserId=${encodeURIComponent(String(discordUserId || ''))}`);
    return payload.account || null;
  }

  async function linkVerifiedBridgeMinecraftUsernames(discordUserId, minecraftUsernames, metadata = {}) {
    return request('/api/bot/links/upsert', {
      method: 'POST',
      body: {
        discordUserId,
        minecraftUsernames,
        discordUsername: metadata.discordUsername,
        discordDisplayName: metadata.discordDisplayName
      }
    });
  }

  async function removeBridgeLinkedAccount(discordUserId) {
    return request('/api/bot/links/remove', {
      method: 'POST',
      body: { discordUserId }
    });
  }

  async function removeBridgeMinecraftUsername(discordUserId, minecraftUsername) {
    return request('/api/bot/links/remove-username', {
      method: 'POST',
      body: { discordUserId, minecraftUsername }
    });
  }

  async function setBridgeEventPreference(discordUserId, eventKey, enabled) {
    return request('/api/bot/links/event-preference', {
      method: 'POST',
      body: { discordUserId, eventKey, enabled }
    });
  }

  async function findBridgeLinkByMinecraftUsername(username) {
    const payload = await request(`/api/link/status?playerName=${encodeURIComponent(String(username || ''))}`);
    if (!payload.linked) {
      return null;
    }

    return {
      discordUserId: payload.discordUserId,
      entry: {
        discordDisplayName: payload.discordDisplayName,
        minecraftUsernames: payload.minecraftUsernames || [],
        preferredMinecraftUsername: payload.preferredMinecraftUsername || '',
        requiresHypixelVerification: payload.requiresHypixelVerification === true,
        eventPreferences: payload.eventPreferences || {}
      }
    };
  }

  async function listHideonleafStats() {
    const payload = await request('/api/bot/hideonleaf');
    return Array.isArray(payload.entries) ? payload.entries : [];
  }

  return {
    getBridgeLinkedAccount,
    linkVerifiedBridgeMinecraftUsernames,
    removeBridgeLinkedAccount,
    removeBridgeMinecraftUsername,
    setBridgeEventPreference,
    findBridgeLinkByMinecraftUsername,
    listHideonleafStats
  };
}

module.exports = { createModBackendClient };
