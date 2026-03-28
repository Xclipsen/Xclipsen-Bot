const http = require('node:http');

function createIrcBridge({ client, env, store }) {
  const mentionPattern = /(^|[\s(])@([a-zA-Z0-9._-]{2,32})\b/g;
  const bufferedMessages = [];
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

    const content = (message.cleanContent || '').trim();
    const imageLinks = [...message.attachments.values()]
      .filter(isImageAttachment)
      .map((attachment) => String(attachment.url || '').trim())
      .filter(Boolean);
    const finalContent = [content, ...imageLinks].filter(Boolean).join(' ').trim();

    if (!finalContent) {
      return;
    }

    const replyPrefix = await buildReplyPrefix(message);

    addBufferedMessage('discord', message.member?.displayName || message.author.username, `${replyPrefix}${finalContent}`, {
      discordUserId: message.author.id
    });
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

  return {
    start,
    stop,
    handleDiscordMessage,
    sendEventMessage
  };
}

module.exports = { createIrcBridge };
