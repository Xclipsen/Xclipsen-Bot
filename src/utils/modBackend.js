function createModBackendClient(env) {
  const baseUrl = String(env.MOD_BACKEND_URL || '').replace(/\/+$/, '');
  const authToken = String(env.MOD_BACKEND_AUTH_TOKEN || '');
  const requestTimeoutMs = 10_000;
  const maximumLinkCodeTtlMs = 15 * 60 * 1000;

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
      signal: AbortSignal.timeout(requestTimeoutMs)
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new Error(`Mod backend returned a non-JSON response (${response.status}).`);
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`Mod backend returned invalid JSON (${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(`Mod backend request failed (${response.status}).`);
    }

    return payload;
  }

  async function getBridgeLinkedAccount(discordUserId) {
    const payload = await request(`/api/bot/links?discordUserId=${encodeURIComponent(String(discordUserId || ''))}`);
    return payload.account || null;
  }

  async function linkVerifiedBridgeMinecraftAccount(discordUserId, minecraftAccount, metadata = {}) {
    const result = await request('/api/bot/links/upsert', {
      method: 'POST',
      body: {
        discordUserId,
        minecraftUsernames: [minecraftAccount.name],
        minecraftAccounts: [minecraftAccount],
        discordUsername: metadata.discordUsername,
        discordDisplayName: metadata.discordDisplayName
      }
    });

    if (result.ok === false) {
      const error = String(result.error || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 200);
      return { ok: false, error: error || 'The Minecraft account could not be linked.' };
    }

    const modLink = await request('/api/bot/links/issue-code', {
      method: 'POST',
      body: {
        discordUserId,
        minecraftUuid: minecraftAccount.uuid
      }
    });
    const code = modLink.code;
    const expiresAt = modLink.expiresAt;
    const linkedAccount = modLink.account;
    const now = Date.now();
    if (
      result.ok !== true ||
      !result.account || typeof result.account !== 'object' || Array.isArray(result.account) ||
      typeof code !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(code) ||
      !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + maximumLinkCodeTtlMs ||
      linkedAccount?.uuid !== minecraftAccount.uuid || linkedAccount?.name !== minecraftAccount.name
    ) {
      throw new Error('Mod backend returned an invalid link-code response.');
    }

    return { ...result, modLink };
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
    linkVerifiedBridgeMinecraftAccount,
    removeBridgeLinkedAccount,
    removeBridgeMinecraftUsername,
    setBridgeEventPreference,
    findBridgeLinkByMinecraftUsername,
    listHideonleafStats
  };
}

module.exports = { createModBackendClient };
