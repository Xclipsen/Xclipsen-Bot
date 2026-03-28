const http = require('node:http');

function createIrcBridge({ client, env }) {
  const mentionPattern = /(^|[\s(])@([a-zA-Z0-9._-]{2,32})\b/g;
  const bufferedMessages = [];
  let nextMessageId = 1;
  let server = null;

  function addBufferedMessage(source, user, content) {
    bufferedMessages.push({
      id: nextMessageId++,
      source,
      user: user || '',
      content: content || ''
    });

    while (bufferedMessages.length > env.IRC_BRIDGE_MAX_BUFFERED_MESSAGES) {
      bufferedMessages.shift();
    }
  }

  function getMessagesAfter(afterId) {
    return bufferedMessages.filter((message) => message.id > afterId);
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
      const playerName = String(payload.playerName || '').replace(/@/g, '@\u200b');
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
      writeJson(response, 200, { messages: getMessagesAfter(Number.isNaN(after) ? 0 : after) });
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
          addBufferedMessage('irc', String(payload.playerName || ''), payload.message.trim());
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
    const attachment = message.attachments.first();
    const finalContent = content || (attachment ? `[Attachment] ${attachment.name}` : '');

    if (!finalContent) {
      return;
    }

    addBufferedMessage('discord', message.member?.displayName || message.author.username, finalContent);
  }

  return {
    start,
    stop,
    handleDiscordMessage
  };
}

module.exports = { createIrcBridge };
