const http = require('node:http');
const { MessageFlags, MessageReferenceType } = require('discord.js');

const COOP_RELAY_DEDUPE_WINDOW_MS = 2500;
const MAX_RECENT_COOP_RELAYS = 250;

// ── Hypixel Bazaar price cache ───────────────────────────────────────────────
// Items tracked in the Shard Profit Tracker.
// Key = Hypixel Bazaar item ID, value = display name as it appears in the Mod HUD
// (i.e. the name extracted from the chat drop message after stripping formatting).
const TRACKED_ITEM_IDS = {
  SHARD_HIDEONLEAF:  'Hideonleaf Shards',
  SHARD_HIDEONBOX:   'Hideonbox Shards',
  SHARD_HIDEONCAVE:  'Hideoncave Shards',
  SHARD_HIDEONDRA:   'Hideondra Shards',
  SHARD_HIDEONGEON:  'Hideongeon Shards',
  SHARD_HIDEONGIFT:  'Hideongift Shards',
  SHARD_HIDEONRING:  'Hideonring Shards',
  SHARD_HIDEONSACK:  'Hideonsack Shards',
};

const BAZAAR_API_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const BAZAAR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let bazaarCache = null;      // { prices: { displayName -> { buyPrice, sellPrice, lastUpdated } } }
let bazaarCacheAt = 0;
let bazaarFetchInFlight = false;

function createIrcBridge({ client, env, store }) {
  const mentionPattern = /(^|[\s(])@([a-zA-Z0-9._-]{2,32})\b/g;
  const bufferedMessages = [];
  const recentCoopRelayKeys = [];
  let nextMessageId = 1;
  let server = null;

  function addBufferedMessage(source, user, content, extra = {}) {
    bufferedMessages.push({
      id: nextMessageId++,
      source,
      user: user || '',
      content: content || '',
      ...extra
    });

    while (bufferedMessages.length > env.IRC_BRIDGE_MAX_BUFFERED_MESSAGES) {
      bufferedMessages.shift();
    }
  }

  function getMessagesAfter(afterId, playerName = '') {
    const linked = store.findBridgeLinkByMinecraftUsername(playerName);
    if (!linked) {
      return [];
    }

    return bufferedMessages.filter((message) => (
      message.id > afterId &&
      shouldDeliverMessageToLinkedUser(message, linked.entry)
    ));
  }

  function isAuthorized(request) {
    return request.headers.authorization === `Bearer ${env.IRC_BRIDGE_AUTH_TOKEN}`;
  }

  function writeJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    response.end(body);
  }

  async function readJson(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const body = Buffer.concat(chunks).toString('utf8');
    return body ? JSON.parse(body) : {};
  }

  async function sendToDiscord(payload) {
    if (!env.IRC_BRIDGE_CHANNEL_ID) {
      return;
    }

    const channel = await client.channels.fetch(env.IRC_BRIDGE_CHANNEL_ID).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      console.warn(`IRC bridge channel ${env.IRC_BRIDGE_CHANNEL_ID} is missing or not text-based.`);
      return;
    }

    let content = '';
    let allowedUserMentions = [];

    if (payload.type === 'status') {
      content = String(payload.message || '');
    } else if (payload.type === 'coop') {
      const coopPlayer = normalizeMinecraftUsername(payload.forwardedPlayerName) || 'Unknown';
      const sanitizedMessage = sanitizeExternalMessage(String(payload.message || ''));
      if (!coopPlayer || !sanitizedMessage) {
        return;
      }

      const linked = store.findBridgeLinkByMinecraftUsername(coopPlayer);
      const playerName = linked
        ? await resolveLinkedDisplayName(channel, linked.discordUserId, coopPlayer)
        : coopPlayer.replace(/@/g, '@\u200b');
      const resolved = await resolveUserMentions(channel, sanitizedMessage);
      content = `[Forwarded Co-op] **${playerName}**: ${resolved.content}`;
      allowedUserMentions = resolved.allowedUserMentions;
    } else {
      const linked = store.findBridgeLinkByMinecraftUsername(String(payload.playerName || ''));
      if (!linked) {
        return;
      }

      const playerName = await resolveLinkedDisplayName(channel, linked.discordUserId, String(payload.playerName || ''));
      const resolved = await resolveUserMentions(channel, String(payload.message || ''));
      const message = resolved.content;
      allowedUserMentions = resolved.allowedUserMentions;
      content = `**${playerName}**: ${message}`;
    }

    if (!content.trim()) {
      return;
    }

    await channel.send({
      content,
      allowedMentions: { parse: [], users: allowedUserMentions }
    });
  }

  async function resolveUserMentions(channel, rawMessage) {
    if (!rawMessage.includes('@') || !channel.guild) {
      return {
        content: rawMessage.replace(/@/g, '@\u200b'),
        allowedUserMentions: []
      };
    }

    const matches = [...rawMessage.matchAll(mentionPattern)];

    if (matches.length === 0) {
      return {
        content: rawMessage.replace(/@/g, '@\u200b'),
        allowedUserMentions: []
      };
    }

    const replacementMap = new Map();
    const allowedUserMentions = [];

    for (const match of matches) {
      const query = match[2];

      if (replacementMap.has(query.toLowerCase())) {
        continue;
      }

      const member = await findMemberByName(channel.guild, query);

      if (member) {
        replacementMap.set(query.toLowerCase(), `<@${member.id}>`);
        allowedUserMentions.push(member.id);
      } else {
        replacementMap.set(query.toLowerCase(), `@${query}`.replace(/@/g, '@\u200b'));
      }
    }

    const content = rawMessage.replace(mentionPattern, (full, prefix, query) => {
      const replacement = replacementMap.get(String(query).toLowerCase()) || `@${query}`.replace(/@/g, '@\u200b');
      return `${prefix}${replacement}`;
    });

    return {
      content,
      allowedUserMentions: [...new Set(allowedUserMentions)]
    };
  }

  async function findMemberByName(guild, query) {
    const lowerQuery = query.toLowerCase();

    const cachedMatch = guild.members.cache.find((member) => memberMatches(member, lowerQuery));

    if (cachedMatch) {
      return cachedMatch;
    }

    const fetched = await guild.members.search({
      query,
      limit: 10
    }).catch(() => null);

    if (fetched) {
      const searchedMatch = fetched.find((member) => memberMatches(member, lowerQuery));

      if (searchedMatch) {
        return searchedMatch;
      }
    }

    const fullFetch = await guild.members.fetch().catch(() => null);

    if (!fullFetch) {
      return null;
    }

    return fullFetch.find((member) => memberMatches(member, lowerQuery)) || null;
  }

  function memberMatches(member, lowerQuery) {
    return (
      member.user.username.toLowerCase() === lowerQuery ||
      (member.user.globalName && member.user.globalName.toLowerCase() === lowerQuery) ||
      member.displayName.toLowerCase() === lowerQuery
    );
  }

  // ── Bazaar price helpers ───────────────────────────────────────────────────

  async function fetchBazaarPrices() {
    // Return cached result if still fresh
    if (bazaarCache && Date.now() - bazaarCacheAt < BAZAAR_CACHE_TTL_MS) {
      return bazaarCache;
    }

    // Avoid parallel in-flight fetches
    if (bazaarFetchInFlight) {
      return bazaarCache;
    }

    if (!env.HYPIXEL_API_KEY) {
      console.warn('[prices] HYPIXEL_API_KEY is not set — cannot fetch Bazaar prices.');
      return bazaarCache;
    }

    bazaarFetchInFlight = true;
    try {
      const response = await fetch(BAZAAR_API_URL, {
        headers: { 'API-Key': env.HYPIXEL_API_KEY },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        console.warn(`[prices] Bazaar API returned HTTP ${response.status}`);
        return bazaarCache; // serve stale on error
      }

      const data = await response.json();

      if (!data.success || !data.products) {
        console.warn('[prices] Bazaar API response missing products field.');
        return bazaarCache;
      }

      const prices = {};
      for (const [itemId, displayName] of Object.entries(TRACKED_ITEM_IDS)) {
        const product = data.products[itemId];
        if (!product) {
          // Item not in Bazaar — leave price at 0 so the Mod falls back to manual value
          continue;
        }

        const buySummary = product.buy_summary;
        const sellSummary = product.sell_summary;
        prices[displayName] = {
          buyPrice: buySummary?.[0]?.pricePerUnit ?? 0,
          sellPrice: sellSummary?.[0]?.pricePerUnit ?? 0,
          lastUpdated: Date.now(),
        };
      }

      bazaarCache = { prices };
      bazaarCacheAt = Date.now();
      console.log(`[prices] Bazaar prices refreshed for ${Object.keys(prices).length} item(s).`);
      return bazaarCache;
    } catch (error) {
      console.error('[prices] Failed to fetch Bazaar prices:', error);
      return bazaarCache; // serve stale on error
    } finally {
      bazaarFetchInFlight = false;
    }
  }

  // ── Request handler ────────────────────────────────────────────────────────

  async function handleRequest(request, response) {
    if (request.url === '/health') {
      writeJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.url.startsWith('/api/link/status')) {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      const playerName = String(url.searchParams.get('playerName') || '');
      const linked = store.findBridgeLinkByMinecraftUsername(playerName);
      writeJson(response, 200, buildLinkStatusPayload(playerName, linked));
      return;
    }

    if (request.url === '/api/link/complete') {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method not allowed' });
        return;
      }

      try {
        const payload = await readJson(request);
        const result = store.completeBridgeLink(payload?.code, payload?.playerName);
        writeJson(response, result.ok ? 200 : 400, result.ok
          ? {
            linked: true,
            playerName: String(payload?.playerName || ''),
            minecraftUsernames: result.account.minecraftUsernames
          }
          : { error: result.error });
      } catch (error) {
        console.error('IRC link completion failed:', error);
        writeJson(response, 500, { error: 'internal error' });
      }
      return;
    }

    if (request.url === '/api/skyblock/prices') {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      try {
        const result = await fetchBazaarPrices();
        writeJson(response, 200, result ?? { prices: {} });
      } catch (error) {
        console.error('[prices] Price endpoint failed:', error);
        writeJson(response, 500, { error: 'internal error' });
      }
      return;
    }

    if (request.url === '/api/hideonleaf') {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method not allowed' });
        return;
      }

      try {
        const payload = await readJson(request);
        const playerName = normalizeMinecraftUsername(payload?.playerName);
        const linked = store.findBridgeLinkByMinecraftUsername(playerName);
        if (!linked) {
          writeJson(response, 403, { error: 'link required' });
          return;
        }

        store.setUserHideonleafStats(playerName, {
          minecraftUsername: playerName || linked.entry.preferredMinecraftUsername || linked.entry.minecraftUsernames?.[0] || '',
          kills: Math.max(0, Number(payload?.kills) || 0),
          totalShards: Math.max(0, Number(payload?.totalShards) || 0),
          totalProfit: Math.max(0, Number(payload?.totalProfit) || 0),
          profitPerHour: Math.max(0, Number(payload?.profitPerHour) || 0),
          totalDurationMs: Math.max(0, Number(payload?.totalDurationMs) || 0),
          items: payload?.items && typeof payload.items === 'object' ? payload.items : {},
          updatedAt: Math.max(0, Number(payload?.updatedAt) || 0)
        });

        writeJson(response, 202, { status: 'accepted' });
      } catch (error) {
        console.error('[hideonleaf] Stats upload failed:', error);
        writeJson(response, 500, { error: 'internal error' });
      }
      return;
    }

    if (request.url === '/api/mob-model') {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method not allowed' });
        return;
      }

      try {
        const payload = await readJson(request);
        const playerName = normalizeMinecraftUsername(payload?.minecraftUsername);
        const linked = store.findBridgeLinkByMinecraftUsername(playerName);
        if (!linked) {
          writeJson(response, 403, { error: 'link required' });
          return;
        }

        store.setUserMobModel(playerName, {
          minecraftUsername: playerName || linked.entry.preferredMinecraftUsername || linked.entry.minecraftUsernames?.[0] || '',
          enabled: payload?.enabled === true,
          entityType: payload?.entityType,
          baby: payload?.baby === true,
          updatedAt: Math.max(0, Number(payload?.updatedAt) || 0)
        });

        writeJson(response, 202, { status: 'accepted' });
      } catch (error) {
        console.error('[mob-model] State upload failed:', error);
        writeJson(response, 500, { error: 'internal error' });
      }
      return;
    }

    if (request.url.startsWith('/api/hideonleaf/status')) {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      const playerName = String(url.searchParams.get('playerName') || '');
      const linked = store.findBridgeLinkByMinecraftUsername(playerName);
      writeJson(response, 200, linked ? (store.getUserHideonleafStats(playerName) || {}) : {});
      return;
    }

    if (request.url.startsWith('/api/mob-models')) {
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: 'unauthorized' });
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      const playerName = String(url.searchParams.get('playerName') || '');
      const linked = store.findBridgeLinkByMinecraftUsername(playerName);
      writeJson(response, 200, {
        states: linked ? store.listMobModels() : []
      });
      return;
    }

    if (!request.url.startsWith('/api/messages')) {
      writeJson(response, 404, { error: 'not found' });
      return;
    }

    if (!isAuthorized(request)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    if (request.method === 'GET') {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      const after = Number.parseInt(url.searchParams.get('after') || '0', 10);
      const playerName = String(url.searchParams.get('playerName') || '');
      writeJson(response, 200, {
        linked: Boolean(store.findBridgeLinkByMinecraftUsername(playerName)),
        messages: getMessagesAfter(Number.isNaN(after) ? 0 : after, playerName)
      });
      return;
    }

    if (request.method === 'POST') {
      try {
        const payload = await readJson(request);

        if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
          writeJson(response, 400, { error: 'invalid payload' });
          return;
        }

        if (payload.type === 'irc') {
          const linked = store.findBridgeLinkByMinecraftUsername(payload.playerName);
          if (!linked) {
            writeJson(response, 403, { error: 'link required' });
            return;
          }

          const linkedDisplayName = await resolveBufferedLinkedDisplayName(linked.discordUserId, linked.entry, String(payload.playerName || ''));
          addBufferedMessage('irc', linkedDisplayName, payload.message.trim(), {
            discordUserId: linked.discordUserId,
            minecraftUsername: String(payload.playerName || '')
          });
        } else if (payload.type === 'coop') {
          const linked = store.findBridgeLinkByMinecraftUsername(payload.playerName);
          if (!linked) {
            writeJson(response, 403, { error: 'link required' });
            return;
          }

          const coopAuthor = normalizeMinecraftUsername(payload.forwardedPlayerName);
          if (!coopAuthor) {
            writeJson(response, 400, { error: 'invalid coop author' });
            return;
          }

          const sanitizedMessage = sanitizeExternalMessage(payload.message);
          if (!sanitizedMessage) {
            writeJson(response, 400, { error: 'invalid payload' });
            return;
          }

          const relayAccepted = registerCoopRelay(coopAuthor, sanitizedMessage);
          if (!relayAccepted) {
            writeJson(response, 202, { status: 'deduplicated' });
            return;
          }
        } else if (payload.type === 'status') {
          addBufferedMessage('status', 'system', payload.message.trim());
        }

        await sendToDiscord(payload);
        writeJson(response, 202, { status: 'accepted' });
      } catch (error) {
        console.error('IRC bridge request failed:', error);
        writeJson(response, 500, { error: 'internal error' });
      }

      return;
    }

    writeJson(response, 405, { error: 'method not allowed' });
  }

  async function start() {
    if (!env.IRC_BRIDGE_ENABLED) {
      return;
    }

    server = http.createServer((request, response) => {
      void handleRequest(request, response);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.IRC_BRIDGE_PORT, env.IRC_BRIDGE_HOST, resolve);
    });

    console.log(`IRC bridge backend listening on ${env.IRC_BRIDGE_HOST}:${env.IRC_BRIDGE_PORT}`);
  }

  async function stop() {
    if (!server) {
      return;
    }

    await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  async function handleDiscordMessage(message) {
    if (!env.IRC_BRIDGE_ENABLED) {
      return;
    }

    if (!env.IRC_BRIDGE_CHANNEL_ID || message.channelId !== env.IRC_BRIDGE_CHANNEL_ID) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    const forwardedPrefix = await extractForwardedPrefix(message);
    const content = (message.cleanContent || '').trim();
    const attachmentInfo = extractAttachmentInfo(message.attachments);
    const finalContent = [forwardedPrefix, content, ...attachmentInfo.imageLinks, ...attachmentInfo.fallbackLabels]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!finalContent) {
      return;
    }

    const replyPrefix = isForwardedMessage(message) ? '' : await buildReplyPrefix(message);

    addBufferedMessage('discord', message.member?.displayName || message.author.username, `${replyPrefix}${finalContent}`, {
      discordUserId: message.author.id
    });
  }

  async function extractForwardedPrefix(message) {
    if (!isForwardedMessage(message)) {
      return '';
    }

    const forwardedParts = [];

    if (message?.messageSnapshots && typeof message.messageSnapshots.values === 'function') {
      for (const snapshot of message.messageSnapshots.values()) {
        const snapshotContent = buildForwardedSnapshotContent(snapshot);
        if (snapshotContent) {
          let snapshotAuthor = buildForwardedSnapshotAuthor(snapshot);

          // Fallback: Discord liefert im Snapshot oft keinen Autor mit —
          // dann die Originalnachricht über die Referenz abrufen.
          if (!snapshotAuthor) {
            const original = await message.fetchReference().catch(() => null);
            if (original) {
              snapshotAuthor = String(
                original.member?.displayName ||
                original.author?.globalName ||
                original.author?.username ||
                ''
              ).replace(/@/g, '@​').trim();
            }
          }

          forwardedParts.push(snapshotAuthor ? `↱ ${snapshotAuthor}: ${snapshotContent}` : `↱ ${snapshotContent}`);
        }
      }
    }

    if (forwardedParts.length === 0) {
      return '↱ Forwarded';
    }

    return forwardedParts.join(' | ');
  }

  function isForwardedMessage(message) {
    return (
      message?.reference?.type === MessageReferenceType.Forward ||
      message?.flags?.has?.(MessageFlags.HasSnapshot) === true ||
      (message?.messageSnapshots?.size || 0) > 0
    );
  }

  function buildForwardedSnapshotContent(snapshot) {
    if (!snapshot) {
      return '';
    }

    const snapshotText = String(snapshot.cleanContent || snapshot.content || '').trim();
    const attachmentInfo = extractAttachmentInfo(snapshot.attachments);

    return [snapshotText, ...attachmentInfo.imageLinks, ...attachmentInfo.fallbackLabels]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function buildForwardedSnapshotAuthor(snapshot) {
    return String(
      snapshot?.member?.displayName ||
      snapshot?.author?.globalName ||
      snapshot?.author?.username ||
      ''
    )
      .replace(/@/g, '@\u200b')
      .trim();
  }

  async function buildReplyPrefix(message) {
    if (!message?.reference?.messageId) {
      return '';
    }

    const referencedMessage = await message.fetchReference().catch(() => null);
    if (!referencedMessage) {
      return '';
    }

    const replyTargetName = String(
      referencedMessage.member?.displayName ||
      referencedMessage.author?.globalName ||
      referencedMessage.author?.username ||
      'unknown'
    ).trim();

    return replyTargetName ? `↳ ${replyTargetName}: ` : '';
  }

  function isImageAttachment(attachment) {
    if (!attachment) {
      return false;
    }

    if (typeof attachment.contentType === 'string' && attachment.contentType.startsWith('image/')) {
      return true;
    }

    return Number.isFinite(attachment.width) || Number.isFinite(attachment.height);
  }

  function extractAttachmentInfo(attachments) {
    if (!attachments || typeof attachments.values !== 'function') {
      return {
        imageLinks: [],
        fallbackLabels: []
      };
    }

    const imageLinks = [];
    const fallbackLabels = [];

    for (const attachment of attachments.values()) {
      if (!attachment) {
        continue;
      }

      if (isImageAttachment(attachment)) {
        const url = String(attachment.url || '').trim();
        if (url) {
          imageLinks.push(url);
        }
        continue;
      }

      const name = String(attachment.name || 'attachment').trim();
      fallbackLabels.push(`[Attachment] ${name}`);
    }

    return {
      imageLinks,
      fallbackLabels
    };
  }

  function sendEventMessage(eventKey, eventName, content, options = {}) {
    if (!env.IRC_BRIDGE_ENABLED) {
      return;
    }

    const key = String(eventKey || '').trim();
    const title = String(eventName || '').trim();
    const message = String(content || '').trim();

    if (!key || !title || !message) {
      return;
    }

    addBufferedMessage('event', 'system', message, {
      title,
      eventKey: key,
      isTest: options.isTest === true
    });
  }

  function shouldDeliverMessageToLinkedUser(message, linkedAccount) {
    if (message.source === 'coop') {
      return false;
    }

    if (message.source !== 'event') {
      return true;
    }

    if (message.isTest) {
      return true;
    }

    return linkedAccount.eventPreferences?.[String(message.eventKey || '').trim()] !== false;
  }

  function buildLinkStatusPayload(playerName, linked) {
    if (!linked) {
      return {
        linked: false,
        playerName: String(playerName || ''),
        minecraftUsernames: []
      };
    }

    return {
      linked: true,
      discordUserId: linked.discordUserId,
      discordDisplayName: getLinkedDisplayName(linked.entry, playerName),
      playerName: String(playerName || ''),
      minecraftUsernames: linked.entry.minecraftUsernames
    };
  }

  function getLinkedDisplayName(linkedEntry, fallbackPlayerName) {
    const fallback = String(fallbackPlayerName || '').trim();
    if (!linkedEntry) {
      return fallback;
    }

    return String(linkedEntry.discordDisplayName || linkedEntry.discordUsername || fallback || '').trim() || fallback;
  }

  async function resolveBufferedLinkedDisplayName(discordUserId, linkedEntry, fallbackPlayerName) {
    const storedName = getLinkedDisplayName(linkedEntry, fallbackPlayerName);
    if (!discordUserId) {
      return storedName;
    }

    const user = await client.users.fetch(discordUserId).catch(() => null);
    return String(user?.globalName || user?.username || storedName).trim() || storedName;
  }

  async function resolveLinkedDisplayName(channel, discordUserId, fallbackPlayerName) {
    const fallback = String(fallbackPlayerName || '').replace(/@/g, '@\u200b');
    if (!discordUserId || !channel.guild) {
      return fallback;
    }

    const member = await channel.guild.members.fetch(discordUserId).catch(() => null);
    return (member?.displayName || member?.user?.globalName || member?.user?.username || fallback).replace(/@/g, '@\u200b');
  }

  function sanitizeExternalMessage(rawMessage) {
    return String(rawMessage || '')
      .replace(/@/g, '@\u200b')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }

  function normalizeMinecraftUsername(value) {
    const raw = String(value || '').trim();
    return /^[A-Za-z0-9_]{3,16}$/.test(raw) ? raw : '';
  }

  function registerCoopRelay(playerName, message) {
    pruneExpiredCoopRelays();
    const key = `${String(playerName || '').toLowerCase()}|${String(message || '').toLowerCase()}`;
    if (!key || recentCoopRelayKeys.some((entry) => entry.key === key)) {
      return false;
    }

    recentCoopRelayKeys.push({
      key,
      expiresAt: Date.now() + COOP_RELAY_DEDUPE_WINDOW_MS
    });

    while (recentCoopRelayKeys.length > MAX_RECENT_COOP_RELAYS) {
      recentCoopRelayKeys.shift();
    }

    return true;
  }

  function pruneExpiredCoopRelays() {
    const now = Date.now();
    while (recentCoopRelayKeys.length > 0 && recentCoopRelayKeys[0].expiresAt < now) {
      recentCoopRelayKeys.shift();
    }
  }

  return {
    start,
    stop,
    handleDiscordMessage,
    sendEventMessage
  };
}

module.exports = { createIrcBridge };
