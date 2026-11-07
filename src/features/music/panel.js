const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const { totalDuration } = require('./queue');

const PANEL_IDS = {
  pause: 'music-panel:pause',
  skip: 'music-panel:skip',
  stop: 'music-panel:stop',
  shuffle: 'music-panel:shuffle',
  loop: 'music-panel:loop',
  autoplay: 'music-panel:autoplay',
  volumeDown: 'music-panel:volume-down',
  volumeUp: 'music-panel:volume-up',
  queue: 'music-panel:queue',
  resume: 'music-panel:continue',
  station: 'music-panel:station',
  playlist: 'music-panel:playlist'
};

// Page buttons of the ephemeral queue / playlist views: music-page:<view>:<arg>:<page>.
const PAGE_PREFIX = 'music-page:';
const PAGE_SIZE = 10;
const LIST_TITLE_LENGTH = 80;
const LOOP_LABELS = { off: 'Loop: off', track: 'Loop: track', queue: 'Loop: queue' };

const COMMAND_OVERVIEW = [
  '`/music play query:<link or search>` play or queue YouTube or a Spotify link',
  '`/music playnext query:<…>` play it right after the current track',
  '`/music radio station:<name>` play a lofi / chill radio station',
  '`/music skip` · `stop` · `pause` · `resume` · `nowplaying` · `volume`',
  '`/music queue` · `shuffle` · `clear` · `loop mode:<off|track|queue>`',
  '`/music autoplay [mode:<on|off>]` similar songs once the queue runs out',
  '`/music remove position:<n>` · `move from:<n> to:<n>` · `continue`',
  '`/playlist create` · `add` · `remove` · `rename` · `delete` your playlists',
  '`/playlist play name:<playlist> [shuffle]` · `show` · `list [user]`',
  '`/playlist save` the queue · `import url:<YouTube playlist>`',
  '`/tts join` · `leave` · `say text:<text>` read messages aloud',
  '`/tts whisper|sleepy|drunk|angry text:<text>` mood voices',
  '`/tts list` · `uservoice` · `voice` · `follow`'
].join('\n');

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '?';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function escapeMarkdown(text) {
  return String(text).replace(/([\\*_`~|[\]<>])/g, '\\$1');
}

function shorten(text, length) {
  const value = String(text);
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function describeLength(item) {
  return item.isLive ? '🔴 Live' : formatDuration(item.duration);
}

function isSpotifyItem(item) {
  return item?.kind === 'spotify' || item?.source === 'spotify';
}

// Plain title; Spotify tracks as "Artist, Artist - Title".
function displayTitle(item) {
  const artists = isSpotifyItem(item) && Array.isArray(item.artists) ? item.artists.slice(0, 3).join(', ') : '';
  return artists ? `${artists} - ${item.title}` : String(item.title);
}

// Who asked for an item: a mention, or "Autoplay" for suggestions.
function describeRequester(item) {
  return item?.addedBy === 'autoplay' ? 'Autoplay' : `<@${item?.requesterId}>`;
}

// Spotify tracks link to Spotify and carry a small marker; they play their YouTube match.
function describeItem(item, { maxTitle = 200 } = {}) {
  const name = escapeMarkdown(shorten(displayTitle(item), maxTitle));
  let title;
  if (item.kind === 'radio') title = `📻 ${name}`;
  else if (isSpotifyItem(item)) title = `🟢 [${name}](${item.spotifyUrl || item.url})`;
  else title = `[${name}](${item.url})`;
  return `${title} · ${describeLength(item)}`;
}

function describeSource(item) {
  if (item.kind === 'radio') return 'Radio';
  if (isSpotifyItem(item)) return item.url ? 'Spotify (played from YouTube)' : 'Spotify (looking for it on YouTube…)';
  return escapeMarkdown(item.author ? `YouTube · ${item.author}` : 'YouTube');
}

// "1:23:45", plus a note for items without a length (live streams).
function describeTotal(items) {
  const { seconds, unknown } = totalDuration(items);
  return `${formatDuration(seconds)}${unknown ? ` + ${unknown} live` : ''}`;
}

function clampPage(page, count) {
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return { page: Math.min(pageCount - 1, Math.max(0, Number.isInteger(page) ? page : 0)), pageCount };
}

function pageRow(prefix, page, pageCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:${page - 1}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}:${page + 1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount - 1)
  );
}

function pagedView({ title, header = [], lines, empty, footer, prefix }, requestedPage) {
  const { page, pageCount } = clampPage(requestedPage, lines.length);
  const shown = lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setColor(0x8e7cc3)
    .setTitle(shorten(title, 256))
    .setDescription([...header, ...(shown.length ? shown : [empty])].join('\n').slice(0, 4096))
    .setFooter({ text: shorten(`Page ${page + 1}/${pageCount} · ${footer}`, 2048) });
  return { embeds: [embed], components: pageCount > 1 ? [pageRow(prefix, page, pageCount)] : [], allowedMentions: { parse: [] } };
}

function numbered(index, text) {
  return `\`${index + 1}.\` ${text}`;
}

// Ephemeral /music queue view.
function buildQueueView({ current = null, queue = [], loop = 'off' }, page = 0) {
  return pagedView({
    title: `🎶 Queue (${queue.length})`,
    header: [current ? `**Now:** ${describeItem(current, { maxTitle: LIST_TITLE_LENGTH })} · ${describeRequester(current)}` : 'Nothing is playing.', ''],
    lines: queue.map((item, index) => numbered(index, `${describeItem(item, { maxTitle: LIST_TITLE_LENGTH })} · ${describeRequester(item)}`)),
    empty: 'The queue is empty.',
    footer: `${queue.length} tracks · total ${describeTotal(queue)} · ${LOOP_LABELS[loop] || LOOP_LABELS.off}`,
    prefix: `${PAGE_PREFIX}queue:-`
  }, page);
}

function visibilityLabel(playlist) {
  return playlist.visibility === 'public' ? '🌐 Public' : '🔒 Private';
}

// Ephemeral /playlist show view.
function buildPlaylistView(playlist, page = 0) {
  return pagedView({
    title: `📃 ${playlist.name}`,
    header: [`${visibilityLabel(playlist)} · by <@${playlist.ownerId}>`, ''],
    lines: playlist.tracks.map((track, index) => numbered(index, describeItem(track, { maxTitle: LIST_TITLE_LENGTH }))),
    empty: 'This playlist is empty. Add tracks with `/playlist add`.',
    footer: `${playlist.tracks.length} tracks · ${describeTotal(playlist.tracks)}`,
    prefix: `${PAGE_PREFIX}playlist:${playlist.id}`
  }, page);
}

// Ephemeral /playlist list view; `ownerId` limits it to one member.
function buildPlaylistListView(playlists, ownerId = null, page = 0) {
  return pagedView({
    title: `📃 Playlists (${playlists.length})`,
    header: ownerId ? [`By <@${ownerId}>`, ''] : [],
    lines: playlists.map((playlist, index) => numbered(index,
      `${playlist.visibility === 'public' ? '🌐' : '🔒'} **${escapeMarkdown(playlist.name)}** · ${playlist.tracks.length} tracks · ${describeTotal(playlist.tracks)} · <@${playlist.ownerId}>`)),
    empty: ownerId ? 'No playlists yet.' : 'No playlists yet. Create one with `/playlist create` or `/playlist save`.',
    footer: '🔒 private · 🌐 public · play one with /playlist play',
    prefix: `${PAGE_PREFIX}list:${ownerId || '-'}`
  }, page);
}

// panelState: { current, queue, paused, loop, autoplay, volume, channelId, stations, playlists, resumable }
// `autoplay` is the server's toggle; `autoplayNote` says why it is not suggesting right now.
// `resumable` is the size of the last interrupted session (0 = none); it adds a Continue button while idle.
// `playToken` identifies the current track; the skip button carries it so a double press skips once.
function buildPanelMessage({ current = null, queue = [], paused = false, loop = 'off', autoplay = false, autoplayNote = null, volume = 50, channelId = null, stations = [], playlists = [], resumable = 0, playToken = 0 }) {
  const nowPlaying = current
    ? [
      describeItem(current),
      `Source: ${describeSource(current)}`,
      `Requested by ${describeRequester(current)}${paused ? ' · ⏸️ paused' : ''}`
    ].join('\n')
    : 'Nothing is playing.';

  const upNext = queue.slice(0, 3).map((item, index) => `${index + 1}. ${describeItem(item, { maxTitle: LIST_TITLE_LENGTH })}`);
  if (queue.length > 3) upNext.push(`…and ${queue.length - 3} more`);

  const embed = new EmbedBuilder()
    .setColor(0x8e7cc3)
    .setTitle('🎶 Music & Radio')
    .setDescription(channelId ? `Playing in <#${channelId}>.` : 'Not in a voice channel. Join one and use `/music play`, pick a station or a playlist.')
    .addFields(
      { name: 'Now playing', value: nowPlaying.slice(0, 1024) },
      { name: `Queue (${queue.length}${queue.length ? ` · ${describeTotal(queue)}` : ''})`, value: (upNext.join('\n') || 'Empty').slice(0, 1024) },
      { name: 'Loop', value: { track: '🔂 Track', queue: '🔁 Queue' }[loop] || 'Off', inline: true },
      { name: 'Autoplay', value: autoplay ? `On${autoplayNote ? ` (${autoplayNote})` : ''}` : 'Off', inline: true },
      { name: 'Volume', value: `${volume}%`, inline: true },
      { name: 'Radio station', value: current?.kind === 'radio' ? escapeMarkdown(current.title) : '—', inline: true },
      { name: 'Commands', value: COMMAND_OVERVIEW }
    )
    .setFooter({ text: 'Music commands only work in this channel. The bot leaves when whoever brought it leaves.' });

  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_IDS.pause)
      .setLabel(paused ? 'Resume' : 'Pause')
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!current),
    new ButtonBuilder().setCustomId(`${PANEL_IDS.skip}:${playToken}`).setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!current),
    new ButtonBuilder().setCustomId(PANEL_IDS.stop).setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(PANEL_IDS.loop)
      .setLabel(LOOP_LABELS[loop] || LOOP_LABELS.off)
      .setEmoji(loop === 'track' ? '🔂' : '🔁')
      .setStyle(loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(PANEL_IDS.autoplay)
      .setLabel(`Autoplay: ${autoplay ? 'on' : 'off'}`)
      .setEmoji('♾️')
      .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!current)
  );
  // Second row: queue tools and volume; a Continue button while nothing plays (at most 5 buttons).
  const extras = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PANEL_IDS.shuffle).setLabel('Shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary).setDisabled(!current || queue.length < 2),
    new ButtonBuilder().setCustomId(PANEL_IDS.volumeDown).setLabel('-10').setEmoji('🔉').setStyle(ButtonStyle.Secondary).setDisabled(volume <= 0),
    new ButtonBuilder().setCustomId(PANEL_IDS.volumeUp).setLabel('+10').setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(volume >= 100),
    new ButtonBuilder().setCustomId(PANEL_IDS.queue).setLabel('Queue').setEmoji('📜').setStyle(ButtonStyle.Secondary).setDisabled(!current)
  );
  if (!current && resumable) {
    extras.addComponents(new ButtonBuilder()
      .setCustomId(PANEL_IDS.resume)
      .setLabel(`Continue (${resumable} track${resumable === 1 ? '' : 's'})`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success));
  }

  const components = [controls, extras];
  if (stations.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(PANEL_IDS.station)
        .setPlaceholder('📻 Pick a radio station')
        .addOptions(stations.slice(0, 25).map((station) => ({
          label: station.name.slice(0, 100),
          value: station.key,
          default: current?.kind === 'radio' && current.stationKey === station.key,
          ...(station.custom ? { description: 'Added by an admin' } : {})
        })))
    ));
  }
  if (playlists.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(PANEL_IDS.playlist)
        .setPlaceholder('📃 Play a playlist')
        .addOptions(playlists.slice(0, 25).map((playlist) => ({
          label: shorten(playlist.name, 100),
          value: playlist.id,
          description: shorten(`${playlist.tracks.length} tracks · ${describeTotal(playlist.tracks)}`, 100)
        })))
    ));
  }

  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

module.exports = {
  PANEL_IDS,
  PAGE_PREFIX,
  COMMAND_OVERVIEW,
  buildPanelMessage,
  buildQueueView,
  buildPlaylistView,
  buildPlaylistListView,
  describeItem,
  describeRequester,
  describeSource,
  displayTitle,
  isSpotifyItem,
  describeLength,
  escapeMarkdown,
  formatDuration,
  shorten
};
