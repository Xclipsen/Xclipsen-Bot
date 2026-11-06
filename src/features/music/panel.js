const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const PANEL_IDS = {
  pause: 'music-panel:pause',
  skip: 'music-panel:skip',
  stop: 'music-panel:stop',
  volumeDown: 'music-panel:volume-down',
  volumeUp: 'music-panel:volume-up',
  station: 'music-panel:station'
};

const COMMAND_OVERVIEW = [
  '`/music play query:<link or search>` play or queue a YouTube video',
  '`/music radio station:<name>` play a lofi / chill radio station',
  '`/music skip` · `stop` · `pause` · `resume`',
  '`/music queue` · `nowplaying` · `volume level:<0-100>`',
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
  return String(text).replace(/([\\*_`~|[\]])/g, '\\$1');
}

function describeItem(item) {
  const title = item.kind === 'radio' ? `📻 ${escapeMarkdown(item.title)}` : `[${escapeMarkdown(item.title)}](${item.url})`;
  const length = item.isLive ? '🔴 Live' : formatDuration(item.duration);
  return `${title} · ${length}`;
}

// panelState: { current, queue, paused, volume, channelId, stations }
function buildPanelMessage({ current = null, queue = [], paused = false, volume = 50, channelId = null, stations = [] }) {
  const nowPlaying = current
    ? [
      describeItem(current),
      `Source: ${current.kind === 'radio' ? 'Radio' : escapeMarkdown(current.author ? `YouTube · ${current.author}` : 'YouTube')}`,
      `Requested by <@${current.requesterId}>${paused ? ' · ⏸️ paused' : ''}`
    ].join('\n')
    : 'Nothing is playing.';

  const upNext = queue.slice(0, 3).map((item, index) => `${index + 1}. ${describeItem(item)}`);
  if (queue.length > 3) upNext.push(`…and ${queue.length - 3} more`);

  const embed = new EmbedBuilder()
    .setColor(0x8e7cc3)
    .setTitle('🎶 Music & Radio')
    .setDescription(channelId ? `Playing in <#${channelId}>.` : 'Not in a voice channel. Join one and use `/music play` or pick a station.')
    .addFields(
      { name: 'Now playing', value: nowPlaying.slice(0, 1024) },
      { name: `Queue (${queue.length})`, value: (upNext.join('\n') || 'Empty').slice(0, 1024) },
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
    new ButtonBuilder().setCustomId(PANEL_IDS.skip).setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!current),
    new ButtonBuilder().setCustomId(PANEL_IDS.stop).setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(!current),
    new ButtonBuilder().setCustomId(PANEL_IDS.volumeDown).setLabel('-10').setEmoji('🔉').setStyle(ButtonStyle.Secondary).setDisabled(volume <= 0),
    new ButtonBuilder().setCustomId(PANEL_IDS.volumeUp).setLabel('+10').setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(volume >= 100)
  );

  const components = [controls];
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

  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

module.exports = { PANEL_IDS, COMMAND_OVERVIEW, buildPanelMessage, describeItem, formatDuration };
