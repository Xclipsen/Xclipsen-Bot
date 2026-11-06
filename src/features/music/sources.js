const childProcess = require('node:child_process');

// YouTube through yt-dlp and radio through ffmpeg; both run as child processes that the
// player kills on skip/stop/leave. The spawner is injectable for tests.
const RESOLVE_TIMEOUT_MS = 30_000;
const PLAYLIST_TIMEOUT_MS = 60_000;
const MAX_IMPORT_TRACKS = 100;
const MAX_TRACK_SECONDS = 3 * 60 * 60;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
// yt-dlp only enables deno by default; the bot image already has node for YouTube's JS challenges.
const YTDLP_COMMON_ARGS = ['--no-playlist', '--no-warnings', '--js-runtimes', 'node'];
// Only the first entry of a search; never walk a whole playlist or channel.
const YTDLP_RESOLVE_ARGS = ['--dump-single-json', '--playlist-items', '1'];
// Playlist imports only list the entries (no per-video lookups), at most MAX_IMPORT_TRACKS.
const YTDLP_PLAYLIST_ARGS = ['--flat-playlist', '--dump-single-json', '--playlist-items', `1:${MAX_IMPORT_TRACKS}`, '--no-warnings', '--js-runtimes', 'node'];
// ffmpeg may only open the radio stream over the network (no file:, concat:, subfile: etc.).
const RADIO_PROTOCOLS = 'http,https,tcp,tls';

class MusicError extends Error {}

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// A link to one video (watch?v=, youtu.be/<id>, /shorts/, /live/, /embed/), not a playlist or channel.
function isYouTubeVideoUrl(value) {
  if (!isYouTubeUrl(value)) return false;
  const url = new URL(value);
  if (url.hostname.toLowerCase() === 'youtu.be') return /^\/[\w-]+\/?$/.test(url.pathname);
  if (url.pathname === '/watch') return Boolean(url.searchParams.get('v'));
  return /^\/(shorts|live|embed)\/[\w-]+\/?$/.test(url.pathname);
}

// The playlist id of a YouTube link (playlist?list=, watch?v=…&list=, youtu.be/…?list=), else null.
function getYouTubePlaylistId(value) {
  if (!isYouTubeUrl(value)) return null;
  const id = new URL(value).searchParams.get('list');
  return id && /^[\w-]{2,64}$/.test(id) ? id : null;
}

function createMusicSources({ ytdlpPath = 'yt-dlp', ffmpegPath = 'ffmpeg', spawn = childProcess.spawn } = {}) {
  function run(command, args, timeoutMs, timeoutMessage = 'Looking up that video took too long. Please try again.') {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new MusicError(timeoutMessage));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error.code === 'ENOENT'
          ? new MusicError('yt-dlp is not installed on the bot host.')
          : error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(Object.assign(new Error(stderr.trim() || `${command} exited with code ${code}`), { stderr }));
      });
    });
  }

  // Resolves a YouTube URL or search text to one playable track.
  async function resolveTrack(query) {
    const text = String(query || '').trim();
    if (!text) throw new MusicError('Give me a YouTube link or something to search for.');
    if (isUrl(text) && !isYouTubeUrl(text)) throw new MusicError('Only YouTube links are supported.');
    if (isUrl(text) && !isYouTubeVideoUrl(text)) throw new MusicError('Only links to a single YouTube video work, not playlists or channels.');

    let output;
    try {
      output = await run(ytdlpPath, [...YTDLP_RESOLVE_ARGS, ...YTDLP_COMMON_ARGS, '--', isUrl(text) ? text : `ytsearch1:${text}`], RESOLVE_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof MusicError) throw error;
      console.error('yt-dlp lookup failed:', error.message.slice(0, 500));
      throw new MusicError(/private|unavailable|removed|age|sign in/i.test(error.message)
        ? 'That video is unavailable (private, removed or age-restricted).'
        : 'Could not load that video from YouTube.');
    }

    let info;
    try {
      info = JSON.parse(output);
    } catch {
      throw new MusicError('Could not read the video details from yt-dlp.');
    }
    // Searches return a playlist with one entry.
    if (Array.isArray(info.entries)) info = info.entries[0];
    if (!info) throw new MusicError('No YouTube video found for that search.');

    const isLive = info.is_live === true || info.live_status === 'is_live';
    if (info.live_status === 'is_upcoming') throw new MusicError('That stream has not started yet.');
    const duration = Number.isFinite(info.duration) ? Math.round(info.duration) : null;
    if (!isLive && duration && duration > MAX_TRACK_SECONDS) {
      throw new MusicError('That video is longer than 3 hours.');
    }

    return {
      kind: 'track',
      // yt-dlp appends the start time to live titles.
      title: String(info.title || 'Unknown title').replace(isLive ? / \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/ : /$^/, '').slice(0, 200),
      url: info.webpage_url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : text),
      source: 'YouTube',
      author: info.channel || info.uploader || null,
      duration: isLive ? null : duration,
      isLive,
      thumbnail: info.thumbnail || null
    };
  }

  // Lists the videos of a YouTube playlist without resolving each one.
  // Returns { title, tracks: [{ kind, title, url, duration, isLive, source }], skipped }.
  async function resolvePlaylist(link) {
    const text = String(link || '').trim();
    const id = getYouTubePlaylistId(text);
    if (!id) throw new MusicError('Give me a link to a YouTube playlist (with `list=` in it).');

    let output;
    try {
      output = await run(ytdlpPath, [...YTDLP_PLAYLIST_ARGS, '--', `https://www.youtube.com/playlist?list=${id}`], PLAYLIST_TIMEOUT_MS,
        'Loading that playlist took too long. Please try again.');
    } catch (error) {
      if (error instanceof MusicError) throw error;
      console.error('yt-dlp playlist lookup failed:', error.message.slice(0, 500));
      throw new MusicError(/private|unavailable|does not exist|removed/i.test(error.message)
        ? 'That playlist is unavailable (private or removed).'
        : 'Could not load that playlist from YouTube.');
    }

    let info;
    try {
      info = JSON.parse(output);
    } catch {
      throw new MusicError('Could not read the playlist details from yt-dlp.');
    }
    const entries = Array.isArray(info?.entries) ? info.entries.slice(0, MAX_IMPORT_TRACKS) : [];
    const tracks = [];
    for (const entry of entries) {
      const videoId = typeof entry?.id === 'string' && /^[\w-]{6,20}$/.test(entry.id) ? entry.id : null;
      const title = String(entry?.title || '');
      // Deleted and private videos stay in playlists as placeholders.
      if (!videoId || /^\[(private|deleted) video\]$/i.test(title) || entry.live_status === 'is_upcoming') continue;
      const isLive = entry.live_status === 'is_live';
      const duration = Number.isFinite(entry.duration) ? Math.round(entry.duration) : null;
      if (!isLive && duration && duration > MAX_TRACK_SECONDS) continue;
      tracks.push({
        kind: 'track',
        title: (title || 'Unknown title').slice(0, 200),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: 'YouTube',
        author: entry.channel || entry.uploader || null,
        duration: isLive ? null : duration,
        isLive,
        thumbnail: null
      });
    }
    if (!tracks.length) throw new MusicError('That playlist has no playable videos.');
    return { title: String(info.title || 'YouTube playlist').slice(0, 200), tracks, skipped: entries.length - tracks.length };
  }

  function attachLogging(child, label) {
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', (error) => console.error(`${label} failed to start:`, error.message));
    child.on('close', (code, signal) => {
      if (code && !signal && !child.stopping) console.error(`${label} exited with code ${code}: ${stderr.trim().slice(-500)}`);
    });
    child.stdout?.on('error', () => {});
    return child;
  }

  // 48 kHz stereo PCM (StreamType.Raw) from ffmpeg; `input` is a URL or 'pipe:0'.
  function spawnFfmpeg(input, stdin, extraArgs = []) {
    return spawn(ffmpegPath, [
      ...extraArgs, '-analyzeduration', '0', '-loglevel', 'error', '-i', input,
      '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: [stdin, 'pipe', 'pipe'] });
  }

  // Track audio: yt-dlp writes the stream into ffmpeg through an OS pipe. (Piping yt-dlp's stdout
  // through prism's FFmpeg in Node broke the pipe after a few seconds under backpressure.)
  // Live streams have no audio-only format, so they fall back to a small video format.
  // yt-dlp runs in its own process group so kill() also ends the ffmpeg it starts for live streams.
  // `startAt` (seconds) makes ffmpeg skip that far into the track, for /music continue.
  function spawnTrack(url, { startAt = 0 } = {}) {
    const ytdlp = attachLogging(spawn(ytdlpPath, ['-f', 'bestaudio/best[height<=480]/best', '-q', ...YTDLP_COMMON_ARGS, '-o', '-', '--', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    }), 'yt-dlp');
    const seek = Number.isFinite(startAt) && startAt > 0 ? ['-ss', String(Math.floor(startAt))] : [];
    const ffmpeg = attachLogging(spawnFfmpeg('pipe:0', ytdlp.stdout, seek), 'ffmpeg');
    // ffmpeg holds its own copy of the pipe; closing ours lets yt-dlp notice when ffmpeg is gone.
    ytdlp.stdout.destroy();

    return {
      stdout: ffmpeg.stdout,
      kill(signal = 'SIGKILL') {
        ytdlp.stopping = true;
        ffmpeg.stopping = true;
        try {
          if (!Number.isInteger(ytdlp.pid)) throw new Error('no pid');
          process.kill(-ytdlp.pid, signal);
        } catch {
          ytdlp.kill(signal);
        }
        ffmpeg.kill(signal);
        return true;
      }
    };
  }

  // Radio: ffmpeg reads the stream itself and reconnects when it drops.
  function spawnRadio(url) {
    const ffmpeg = attachLogging(spawnFfmpeg(url, 'ignore', [
      '-protocol_whitelist', RADIO_PROTOCOLS,
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5'
    ]), 'ffmpeg radio');
    return {
      stdout: ffmpeg.stdout,
      kill(signal = 'SIGKILL') {
        ffmpeg.stopping = true;
        ffmpeg.kill(signal);
        return true;
      }
    };
  }

  return { resolveTrack, resolvePlaylist, spawnTrack, spawnRadio };
}

module.exports = { createMusicSources, isYouTubeUrl, isYouTubeVideoUrl, getYouTubePlaylistId, MusicError, MAX_TRACK_SECONDS, MAX_IMPORT_TRACKS };
