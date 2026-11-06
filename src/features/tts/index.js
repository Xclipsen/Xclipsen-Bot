const { Readable } = require('node:stream');
const { MessageFlags, PermissionsBitField } = require('discord.js');

const { createTtsClient } = require('./ttsClient');
const { toSpeakerName, toSpeechText } = require('./speechText');

const CONNECT_TIMEOUT_MS = 20_000;
// Mood subcommands: one Thorsten speaker each, announced with a matching verb.
const MOOD_SUBCOMMANDS = {
  whisper: { voice: 'thorsten_whisper', verb: 'flüstert' },
  sleepy: { voice: 'thorsten_sleepy', verb: 'murmelt verschlafen' },
  drunk: { voice: 'thorsten_drunk', verb: 'lallt' },
  angry: { voice: 'thorsten_angry', verb: 'schreit' }
};
const RECONNECT_TIMEOUT_MS = 5_000;

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

// One voice session per guild: the bot sits in the voice channel of the member who ran /tts join
// and leaves when that member leaves. Only members of the TTS role (or server managers) that are
// in the same voice channel are read aloud.
function createTtsFeature({
  client,
  env,
  store,
  voice = require('@discordjs/voice'),
  ttsClient = env.TTS_URL ? createTtsClient({ baseUrl: env.TTS_URL }) : null
}) {
  const sessions = new Map();

  function getTtsConfig(guildId) {
    return store.getGuildConfig(guildId).tts;
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

  function destroySession(session, reason) {
    if (sessions.get(session.guildId) !== session) return;
    sessions.delete(session.guildId);
    session.queue.length = 0;
    session.player.stop(true);
    if (session.connection.state.status !== voice.VoiceConnectionStatus.Destroyed) {
      session.connection.destroy();
    }
    console.log(`TTS session in guild ${session.guildId} ended: ${reason}`);
  }

  async function notify(session, content) {
    const channel = client.channels.cache.get(session.textChannelId);
    await channel?.send?.({ content, allowedMentions: { parse: [] } }).catch(() => {});
  }

  function playNext(session) {
    if (session.playing || sessions.get(session.guildId) !== session) return;
    const item = session.queue.shift();
    if (!item) return;

    session.playing = true;
    item.audio
      .then((audio) => {
        if (sessions.get(session.guildId) !== session) return;
        const resource = voice.createAudioResource(Readable.from(audio), { inputType: voice.StreamType.Arbitrary });
        session.player.play(resource);
      })
      .catch((error) => {
        console.error(`TTS synthesis failed in guild ${session.guildId}:`, error.message);
        session.playing = false;
        playNext(session);
      });
  }

  // Synthesis starts right away so the next line is ready when the current one ends.
  // A mood verb is always announced; plain text only when the speaker changes.
  function enqueue(session, member, text, { voice: voiceId = null, verb = null } = {}) {
    if (session.queue.length >= env.TTS_MAX_QUEUE) {
      return false;
    }

    const speakerName = toSpeakerName(member.displayName) || 'Jemand';
    const spoken = verb || session.lastSpeakerId !== member.id ? `${speakerName} ${verb || 'sagt'}: ${text}` : text;
    session.lastSpeakerId = member.id;

    const audio = ttsClient.synthesize(spoken, voiceId || getTtsConfig(session.guildId).voice);
    audio.catch(() => {});
    session.queue.push({ audio });
    playNext(session);
    return true;
  }

  function createSession({ guild, channel, textChannelId, ownerId }) {
    const connection = voice.joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    const player = voice.createAudioPlayer();
    connection.subscribe(player);

    const session = {
      guildId: guild.id,
      channelId: channel.id,
      textChannelId,
      ownerId,
      connection,
      player,
      queue: [],
      playing: false,
      lastSpeakerId: null
    };

    player.on(voice.AudioPlayerStatus.Idle, () => {
      session.playing = false;
      playNext(session);
    });
    player.on('error', (error) => {
      console.error(`TTS playback failed in guild ${session.guildId}:`, error.message);
    });

    // Recommended @discordjs/voice handling: a disconnect that does not turn into a reconnect is final.
    connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
          voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS)
        ]);
      } catch {
        destroySession(session, 'disconnected');
      }
    });
    connection.on(voice.VoiceConnectionStatus.Destroyed, () => destroySession(session, 'connection destroyed'));

    sessions.set(guild.id, session);
    return session;
  }

  async function handleJoin(interaction, member) {
    const channel = member.voice?.channel;
    if (!channel) {
      await replyEphemeral(interaction, 'Join a voice channel first, then run `/tts join`.');
      return;
    }

    const existing = sessions.get(interaction.guildId);
    if (existing) {
      if (existing.channelId === channel.id) {
        existing.textChannelId = interaction.channelId;
        await replyEphemeral(interaction, `I'm already in <#${channel.id}>. Messages from <#${interaction.channelId}> are read aloud now.`);
      } else {
        await replyEphemeral(interaction, `I'm already reading in <#${existing.channelId}>.`);
      }
      return;
    }

    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
      await replyEphemeral(interaction, `I need the Connect and Speak permissions in <#${channel.id}>.`);
      return;
    }

    await interaction.deferReply();
    const session = createSession({ guild: interaction.guild, channel, textChannelId: interaction.channelId, ownerId: member.id });

    try {
      await voice.entersState(session.connection, voice.VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    } catch (error) {
      destroySession(session, 'could not connect');
      console.error(`TTS could not join ${channel.id} in guild ${interaction.guildId}:`, error.message);
      await interaction.editReply('Could not join the voice channel. Please try again.');
      return;
    }

    await interaction.editReply(
      `🔊 Joined <#${channel.id}>. I read messages from <#${interaction.channelId}> and the voice chat `
      + `by members with the TTS role who are in the channel. I leave when <@${member.id}> leaves.`
    );
  }

  async function handleLeave(interaction, member) {
    const session = sessions.get(interaction.guildId);
    if (!session) {
      await replyEphemeral(interaction, "I'm not in a voice channel.");
      return;
    }

    const isManager = member.permissions?.has(PermissionsBitField.Flags.ManageGuild) || env.PRIVILEGED_USER_IDS.has(member.id);
    if (session.ownerId !== member.id && member.voice?.channelId !== session.channelId && !isManager) {
      await replyEphemeral(interaction, `Only members in <#${session.channelId}> can make me leave.`);
      return;
    }

    destroySession(session, `/tts leave by ${member.id}`);
    await interaction.reply({ content: '👋 Left the voice channel.', allowedMentions: { parse: [] } });
  }

  async function handleSay(interaction, member, { voice: voiceId = null, verb = null } = {}) {
    const session = sessions.get(interaction.guildId);
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

    if (!enqueue(session, member, text, { voice: voiceId || interaction.options.getString('voice'), verb })) {
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
  async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    const session = sessions.get(message.guildId);
    if (!session || (message.channelId !== session.textChannelId && message.channelId !== session.channelId)) return;

    const member = message.member;
    if (!member || member.voice?.channelId !== session.channelId || !hasTtsAccess(member)) return;

    const text = toSpeechText(message.content, createResolvers(message.guild));
    if (!text) return;

    if (!enqueue(session, member, text)) {
      await message.react('⏳').catch(() => {});
    }
  }

  async function handleVoiceStateUpdate(oldState, newState) {
    const session = sessions.get(oldState.guild.id);
    if (!session) return;

    if (newState.id === client.user?.id) {
      if (!newState.channelId) {
        destroySession(session, 'bot was disconnected');
      } else {
        session.channelId = newState.channelId;
      }
      return;
    }

    if (oldState.id === session.ownerId && oldState.channelId === session.channelId && newState.channelId !== session.channelId) {
      destroySession(session, 'owner left the voice channel');
      await notify(session, `👋 <@${session.ownerId}> left the voice channel, so I left too.`);
    }
  }

  function destroyAll() {
    for (const session of [...sessions.values()]) {
      destroySession(session, 'shutdown');
    }
  }

  return {
    ensureRole,
    handleTtsCommand,
    handleVoiceAutocomplete,
    handleMessage,
    handleVoiceStateUpdate,
    destroyAll,
    getSession: (guildId) => sessions.get(guildId) || null
  };
}

module.exports = { createTtsFeature };
