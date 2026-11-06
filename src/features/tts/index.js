const { Readable } = require('node:stream');
const { MessageFlags, PermissionsBitField } = require('discord.js');

const { createTtsClient } = require('./ttsClient');
const { toSpeakerName, toSpeechText } = require('./speechText');

// Mood subcommands: one Thorsten speaker each, announced with a matching verb.
const MOOD_SUBCOMMANDS = {
  whisper: { voice: 'thorsten_whisper', verb: 'flüstert' },
  sleepy: { voice: 'thorsten_sleepy', verb: 'murmelt verschlafen' },
  drunk: { voice: 'thorsten_drunk', verb: 'lallt' },
  angry: { voice: 'thorsten_angry', verb: 'schreit' }
};

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

// TTS on top of the shared voice session (src/features/voice/sessions.js): the bot sits in the
// voice channel of the member who brought it there and leaves when that member leaves. Only TTS
// role members in the same voice channel, and users on the follow list, are read aloud.
function createTtsFeature({
  client,
  env,
  store,
  voiceSessions,
  voice = require('@discordjs/voice'),
  ttsClient = env.TTS_URL ? createTtsClient({ baseUrl: env.TTS_URL }) : null
}) {
  // guildId -> { queue, playing, lastSpeakerId, textChannelId }; textChannelId is set by /tts join.
  const states = new Map();
  voiceSessions.onEnd((session) => states.delete(session.guildId));

  function getState(session) {
    let state = states.get(session.guildId);
    if (!state) {
      state = { queue: [], playing: false, lastSpeakerId: null, textChannelId: null, session };
      states.set(session.guildId, state);
      session.speechPlayer.on(voice.AudioPlayerStatus.Idle, () => {
        state.playing = false;
        playNext(state);
      });
    }
    return state;
  }

  function isActive(state) {
    return states.get(state.session.guildId) === state && voiceSessions.get(state.session.guildId) === state.session;
  }

  function getTtsConfig(guildId) {
    return store.getGuildConfig(guildId).tts;
  }

  // Reading a member's messages needs the role itself; admins can use the commands without it.
  function hasTtsRole(member) {
    const { roleId } = getTtsConfig(member.guild.id);
    return Boolean(roleId) && member.roles?.cache?.has(roleId) === true;
  }

  function hasTtsAccess(member) {
    if (!member) return false;
    if (env.PRIVILEGED_USER_IDS.has(String(member.id))) return true;
    if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
    const { roleId } = getTtsConfig(member.guild.id);
    return Boolean(roleId) && member.roles?.cache?.has(roleId) === true;
  }

  async function ensureRole(guild) {
    const config = getTtsConfig(guild.id);
    let role = config.roleId
      ? guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null)
      : null;

    if (!role) {
      role = guild.roles.cache.find((entry) => normalizeName(entry.name) === normalizeName(env.TTS_ROLE_NAME)) || null;
    }

    if (!role) {
      try {
        role = await guild.roles.create({
          name: env.TTS_ROLE_NAME,
          permissions: [],
          mentionable: false,
          reason: 'Members with this role can use the TTS bot (/tts).'
        });
        console.log(`Created TTS role ${role.id} in guild ${guild.id} (${guild.name})`);
      } catch (error) {
        console.error(`Could not create the TTS role in guild ${guild.id} (${guild.name}); the bot needs Manage Roles:`, error.message);
        return null;
      }
    }

    if (role.id !== config.roleId) {
      store.setGuildConfig(guild.id, { tts: { ...config, roleId: role.id } });
    }

    return role;
  }

  async function replyEphemeral(interaction, content) {
    const payload = { content, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }

  function playNext(state) {
    if (state.playing || !isActive(state)) return;
    const item = state.queue.shift();
    if (!item) return;

    state.playing = true;
    item.audio
      .then((audio) => {
        if (!isActive(state)) return;
        const resource = voice.createAudioResource(Readable.from(audio), { inputType: voice.StreamType.Arbitrary });
        state.session.speechPlayer.play(resource);
      })
      .catch((error) => {
        console.error(`TTS synthesis failed in guild ${state.session.guildId}:`, error.message);
        state.playing = false;
        playNext(state);
      });
  }

  // Synthesis starts right away so the next line is ready when the current one ends.
  // A mood verb is always announced; plain text only when the speaker changes.
  function enqueue(state, member, text, { voice: voiceId = null, verb = null } = {}) {
    if (state.queue.length >= env.TTS_MAX_QUEUE) {
      return false;
    }

    const speakerName = toSpeakerName(member.displayName) || 'Jemand';
    const spoken = verb || state.lastSpeakerId !== member.id ? `${speakerName} ${verb || 'sagt'}: ${text}` : text;
    state.lastSpeakerId = member.id;

    const config = getTtsConfig(state.session.guildId);
    const audio = ttsClient.synthesize(spoken, voiceId || config.userVoices[member.id] || config.voice);
    audio.catch(() => {});
    state.queue.push({ audio });
    playNext(state);
    return true;
  }

  async function handleJoin(interaction, member) {
    const channel = member.voice?.channel;
    if (!channel) {
      await replyEphemeral(interaction, 'Join a voice channel first, then run `/tts join`.');
      return;
    }

    const existing = voiceSessions.get(interaction.guildId);
    if (existing) {
      if (existing.channelId === channel.id) {
        getState(existing).textChannelId = interaction.channelId;
        await replyEphemeral(interaction, `I'm in <#${channel.id}>. Messages from <#${interaction.channelId}> are read aloud now.`);
      } else {
        await replyEphemeral(interaction, `I'm already in <#${existing.channelId}>.`);
      }
      return;
    }

    await interaction.deferReply();
    let session;
    try {
      ({ session } = await voiceSessions.join({
        guild: interaction.guild,
        channel,
        ownerId: member.id,
        notifyChannelId: interaction.channelId
      }));
    } catch (error) {
      await interaction.editReply(error.message);
      return;
    }
    getState(session).textChannelId = interaction.channelId;

    await interaction.editReply(
      `🔊 Joined <#${channel.id}>. I read messages from <#${interaction.channelId}> and the voice chat `
      + `by members with the TTS role who are in the channel. I leave when <@${member.id}> leaves.`
    );
  }

  async function handleLeave(interaction, member) {
    const session = voiceSessions.get(interaction.guildId);
    if (!session) {
      await replyEphemeral(interaction, "I'm not in a voice channel.");
      return;
    }

    const isManager = member.permissions?.has(PermissionsBitField.Flags.ManageGuild) || env.PRIVILEGED_USER_IDS.has(member.id);
    if (session.ownerId !== member.id && member.voice?.channelId !== session.channelId && !isManager) {
      await replyEphemeral(interaction, `Only members in <#${session.channelId}> can make me leave.`);
      return;
    }

    voiceSessions.leave(session.guildId, `/tts leave by ${member.id}`);
    await interaction.reply({ content: '👋 Left the voice channel.', allowedMentions: { parse: [] } });
  }

  async function handleSay(interaction, member, { voice: voiceId = null, verb = null } = {}) {
    const session = voiceSessions.get(interaction.guildId);
    if (!session) {
      await replyEphemeral(interaction, 'Use `/tts join` first.');
      return;
    }

    if (member.voice?.channelId !== session.channelId) {
      await replyEphemeral(interaction, `You need to be in <#${session.channelId}> to use TTS.`);
      return;
    }

    const text = toSpeechText(interaction.options.getString('text', true), createResolvers(interaction.guild));
    if (!text) {
      await replyEphemeral(interaction, 'There is nothing to read in that text.');
      return;
    }

    if (!enqueue(getState(session), member, text, { voice: voiceId || interaction.options.getString('voice'), verb })) {
      await replyEphemeral(interaction, 'The queue is full, please wait a moment.');
      return;
    }

    await replyEphemeral(interaction, '🔊 Queued.');
  }

  async function handleVoice(interaction) {
    const voiceId = interaction.options.getString('voice', true);
    const voices = await ttsClient.listVoices().catch(() => null);
    if (voices && !voices.some((entry) => entry.id === voiceId)) {
      await replyEphemeral(interaction, `Unknown voice \`${voiceId}\`. Pick one from the list.`);
      return;
    }

    const config = getTtsConfig(interaction.guildId);
    store.setGuildConfig(interaction.guildId, { tts: { ...config, voice: voiceId } });
    await replyEphemeral(interaction, `TTS voice for this server set to \`${voiceId}\`.`);
  }

  async function handleFollow(interaction) {
    if (!env.PRIVILEGED_USER_IDS.has(String(interaction.user.id))) {
      await replyEphemeral(interaction, 'Only the bot owners can use `/tts follow`.');
      return;
    }

    const user = interaction.options.getUser('user', true);
    const config = getTtsConfig(interaction.guildId);
    const following = config.followUserIds.includes(user.id);
    const enabled = interaction.options.getBoolean('enabled') ?? !following;
    const followUserIds = enabled
      ? [...new Set([...config.followUserIds, user.id])]
      : config.followUserIds.filter((id) => id !== user.id);

    store.setGuildConfig(interaction.guildId, { tts: { ...config, followUserIds } });
    await replyEphemeral(interaction, enabled
      ? `Every message from <@${user.id}> is read aloud while I'm in a voice channel.`
      : `Stopped reading every message from <@${user.id}>.`);
  }

  async function handleUserVoice(interaction, member, accessControl) {
    const user = interaction.options.getUser('user', true);
    const voiceId = interaction.options.getString('voice');

    if (user.id !== member.id && !accessControl.hasAccess(interaction)) {
      await replyEphemeral(interaction, 'You can only change your own voice. Admins can set voices for others.');
      return;
    }

    if (voiceId) {
      const voices = await ttsClient.listVoices().catch(() => null);
      if (voices && !voices.some((entry) => entry.id === voiceId)) {
        await replyEphemeral(interaction, `Unknown voice \`${voiceId}\`. Pick one from the list.`);
        return;
      }
    }

    const config = getTtsConfig(interaction.guildId);
    const userVoices = { ...config.userVoices };
    if (voiceId) userVoices[user.id] = voiceId;
    else delete userVoices[user.id];

    store.setGuildConfig(interaction.guildId, { tts: { ...config, userVoices } });
    await replyEphemeral(interaction, voiceId
      ? `<@${user.id}> now speaks with \`${voiceId}\`.`
      : `<@${user.id}> uses the server voice again.`);
  }

  async function handleList(interaction) {
    const config = getTtsConfig(interaction.guildId);
    const session = voiceSessions.get(interaction.guildId);
    const state = states.get(interaction.guildId);
    const role = config.roleId ? interaction.guild.roles.cache.get(config.roleId) : null;
    // Role members are only complete once all members are fetched; small servers, so fetch them.
    await interaction.guild.members.fetch().catch(() => null);
    const roleMembers = role ? [...role.members.values()].map((entry) => `<@${entry.id}>`) : [];
    const followed = config.followUserIds.map((id) => `<@${id}>`);
    const userVoices = Object.entries(config.userVoices).map(([id, voiceId]) => `<@${id}> → \`${voiceId}\``);

    const lines = [
      session
        ? `🔊 In <#${session.channelId}>${state?.textChannelId ? `, reading <#${state.textChannelId}> and the voice chat` : ''}; leaves with <@${session.ownerId}>.`
        : '🔇 Not in a voice channel.',
      `**Read when in the voice channel** (${role ? `<@&${role.id}>` : 'no TTS role'}): ${roleMembers.join(', ') || 'nobody'}`,
      `**Followed, read from every channel:** ${followed.join(', ') || 'nobody'}`,
      `**Server voice:** \`${config.voice || 'default'}\``,
      `**Own voices:** ${userVoices.join(', ') || 'none'}`
    ];
    await replyEphemeral(interaction, lines.join('\n').slice(0, 2000));
  }

  async function handleTtsCommand(interaction, accessControl) {
    if (!interaction.inGuild() || !interaction.guild) {
      await replyEphemeral(interaction, 'TTS only works inside a server.');
      return;
    }

    if (!ttsClient) {
      await replyEphemeral(interaction, 'TTS is not configured on this bot (TTS_URL is missing).');
      return;
    }

    const member = interaction.member?.voice
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'follow') {
      await handleFollow(interaction);
      return;
    }

    if (subcommand === 'list') {
      await handleList(interaction);
      return;
    }

    if (subcommand === 'voice') {
      if (await accessControl.ensureSetupAccess(interaction, 'TTS voice setting')) {
        await handleVoice(interaction);
      }
      return;
    }

    if (!hasTtsAccess(member)) {
      const { roleId } = getTtsConfig(interaction.guildId);
      await replyEphemeral(interaction, roleId ? `You need the <@&${roleId}> role to use TTS.` : 'TTS is not set up on this server yet.');
      return;
    }

    if (subcommand === 'join') await handleJoin(interaction, member);
    else if (subcommand === 'leave') await handleLeave(interaction, member);
    else if (subcommand === 'say') await handleSay(interaction, member);
    else if (subcommand === 'uservoice') await handleUserVoice(interaction, member, accessControl);
    else if (Object.hasOwn(MOOD_SUBCOMMANDS, subcommand)) await handleSay(interaction, member, MOOD_SUBCOMMANDS[subcommand]);
  }

  async function handleVoiceAutocomplete(interaction) {
    const query = normalizeName(interaction.options.getFocused());
    const voices = ttsClient ? await ttsClient.listVoices().catch(() => []) : [];
    await interaction.respond(voices
      .filter((entry) => normalizeName(`${entry.id} ${entry.label}`).includes(query))
      .slice(0, 25)
      .map((entry) => ({ name: entry.label ? `${entry.label} (${entry.id})` : entry.id, value: entry.id })));
  }

  function createResolvers(guild) {
    return {
      resolveUser: (id) => toSpeakerName(guild.members.cache.get(id)?.displayName || client.users.cache.get(id)?.username),
      resolveChannel: (id) => guild.channels.cache.get(id)?.name?.replace(/[-_]+/g, ' ') || null,
      resolveRole: (id) => guild.roles.cache.get(id)?.name || null,
      maxLength: env.TTS_MAX_CHARS
    };
  }

  // Reads messages from the channel where /tts join ran and from the voice channel's own chat.
  // Followed users (/tts follow) are read from every channel, wherever they are.
  async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    const session = voiceSessions.get(message.guildId);
    if (!session) return;

    const member = message.member;
    if (!member) return;

    // Without /tts join (e.g. the bot only plays music) just followed users are read.
    const state = states.get(message.guildId);
    const followed = getTtsConfig(message.guildId).followUserIds.includes(member.id);
    if (!followed) {
      if (!state?.textChannelId) return;
      if (message.channelId !== state.textChannelId && message.channelId !== session.channelId) return;
      if (member.voice?.channelId !== session.channelId || !hasTtsRole(member)) return;
    }

    const text = toSpeechText(message.content, createResolvers(message.guild));
    if (!text) return;

    if (!enqueue(state || getState(session), member, text)) {
      await message.react('⏳').catch(() => {});
    }
  }

  return {
    ensureRole,
    handleTtsCommand,
    handleVoiceAutocomplete,
    handleMessage
  };
}

module.exports = { createTtsFeature };
