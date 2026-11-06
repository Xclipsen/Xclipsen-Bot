// One voice connection per guild, shared by TTS and music.
// Each session has two audio players: speech (TTS) and music. The connection plays music and
// switches to speech while a line is spoken; the music player then auto-pauses (tracks) or keeps
// running unheard (live radio, see NoSubscriberBehavior.Play) and is heard again afterwards.
// The bot leaves when the member who brought it into the channel leaves.

const CONNECT_TIMEOUT_MS = 20_000;
const RECONNECT_TIMEOUT_MS = 5_000;

function createVoiceSessions({ client, voice = require('@discordjs/voice') }) {
  const sessions = new Map();
  const endListeners = new Set();

  function get(guildId) {
    return sessions.get(guildId) || null;
  }

  function isCurrent(session) {
    return sessions.get(session.guildId) === session;
  }

  async function notify(session, content) {
    const channel = session.notifyChannelId ? client.channels.cache.get(session.notifyChannelId) : null;
    await channel?.send?.({ content, allowedMentions: { parse: [] } }).catch(() => {});
  }

  function leave(guildId, reason) {
    const session = sessions.get(guildId);
    if (!session) return false;
    sessions.delete(guildId);
    session.speechPlayer.stop(true);
    session.musicPlayer.stop(true);
    if (session.connection.state.status !== voice.VoiceConnectionStatus.Destroyed) {
      session.connection.destroy();
    }
    console.log(`Voice session in guild ${guildId} ended: ${reason}`);
    for (const listener of endListeners) {
      try {
        listener(session, reason);
      } catch (error) {
        console.error('Voice session end listener failed:', error);
      }
    }
    return true;
  }

  function createSession({ guild, channel, ownerId, notifyChannelId }) {
    const connection = voice.joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    const speechPlayer = voice.createAudioPlayer();
    const musicPlayer = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
    connection.subscribe(musicPlayer);

    const session = {
      guildId: guild.id,
      channelId: channel.id,
      ownerId,
      notifyChannelId,
      connection,
      speechPlayer,
      musicPlayer
    };

    speechPlayer.on(voice.AudioPlayerStatus.Playing, () => {
      if (isCurrent(session)) connection.subscribe(speechPlayer);
    });
    speechPlayer.on(voice.AudioPlayerStatus.Idle, () => {
      if (isCurrent(session)) connection.subscribe(musicPlayer);
    });
    speechPlayer.on('error', (error) => console.error(`Speech playback failed in guild ${guild.id}:`, error.message));
    musicPlayer.on('error', (error) => console.error(`Music playback failed in guild ${guild.id}:`, error.message));

    // Recommended @discordjs/voice handling: a disconnect that does not turn into a reconnect is final.
    connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
          voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS)
        ]);
      } catch {
        if (isCurrent(session)) leave(guild.id, 'disconnected');
      }
    });
    connection.on(voice.VoiceConnectionStatus.Destroyed, () => {
      if (isCurrent(session)) leave(guild.id, 'connection destroyed');
    });

    sessions.set(guild.id, session);
    return session;
  }

  // Joins `channel` or returns the existing session of the guild.
  // Resolves { session, created }; rejects with a user-facing message when that is not possible.
  async function join({ guild, channel, ownerId, notifyChannelId }) {
    const existing = sessions.get(guild.id);
    if (existing) {
      if (existing.channelId !== channel.id) {
        throw new Error(`I'm already in <#${existing.channelId}>.`);
      }
      return { session: existing, created: false };
    }

    const permissions = channel.permissionsFor?.(guild.members.me);
    if (permissions && !permissions.has(['Connect', 'Speak'])) {
      throw new Error(`I need the Connect and Speak permissions in <#${channel.id}>.`);
    }

    const session = createSession({ guild, channel, ownerId, notifyChannelId });
    try {
      await voice.entersState(session.connection, voice.VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    } catch (error) {
      console.error(`Could not join voice channel ${channel.id} in guild ${guild.id}:`, error.message);
      leave(guild.id, 'could not connect');
      throw new Error('Could not join the voice channel. Please try again.');
    }

    return { session, created: true };
  }

  async function handleVoiceStateUpdate(oldState, newState) {
    const session = sessions.get(oldState.guild.id);
    if (!session) return;

    if (newState.id === client.user?.id) {
      if (!newState.channelId) {
        leave(session.guildId, 'bot was disconnected');
      } else {
        session.channelId = newState.channelId;
      }
      return;
    }

    if (oldState.id === session.ownerId && oldState.channelId === session.channelId && newState.channelId !== session.channelId) {
      leave(session.guildId, 'owner left the voice channel');
      await notify(session, `👋 <@${session.ownerId}> left the voice channel, so I left too.`);
    }
  }

  function destroyAll() {
    for (const guildId of [...sessions.keys()]) {
      leave(guildId, 'shutdown');
    }
  }

  return {
    get,
    join,
    leave,
    onEnd: (listener) => endListeners.add(listener),
    handleVoiceStateUpdate,
    destroyAll
  };
}

module.exports = { createVoiceSessions };
