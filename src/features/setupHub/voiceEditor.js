const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder,
  UserSelectMenuBuilder, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField } = require('discord.js');
const { createHash } = require('node:crypto');
const { createTtsClient } = require('../tts/ttsClient');
const { interactionIds } = require('../../config/interactionIds');

// The "Voice" setup section (TTS + music settings). Same id scheme as ./editor.js: `admin:<action>:voice:<field>[:<userId>]`.
const SECTION = 'voice';
const FIELDS = [
  ['role', 'TTS role'],
  ['voice', 'Server voice'],
  ['uservoices', 'Personal voices'],
  ['follow', 'Follow list'],
  ['channel', 'Music control channel'],
  ['volume', 'Playback volume'],
  ['stations', 'Radio stations']
];
const MAX_STATIONS = 25;
const MAX_STATION_NAME = 50;
const MAX_STATION_URL = 500;
const VOLUME_STEP = 10;
// Discord allows 25 options per select; one is taken by the default / reset entry.
const MAX_VOICE_OPTIONS = 24;
const DEFAULT_VOICE_VALUE = '__default__';
const SERVER_VOICE_VALUE = '__server__';
const SNOWFLAKE = /^\d{16,20}$/;
const id = (action, field, arg) => `admin:${action}:${SECTION}:${field}${arg ? `:${arg}` : ''}`;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
const clampVolume = value => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
const stationKey = station => createHash('sha1').update(`${station.name}\n${station.url}`).digest('hex').slice(0, 16);

// Lines joined up to Discord's 1024-character field limit, with a "… and N more" tail.
function fitLines(lines, empty) {
  if (!lines.length) return empty;
  const out = [];
  let length = 0;
  for (const [index, line] of lines.entries()) {
    const tail = `\n… and ${lines.length - index} more`;
    if (length + line.length + 1 + tail.length > 1024) { out.push(tail.trim()); break; }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

// Name 1–50 characters, http(s) URL with a host, no duplicate name or URL, at most 25 stations.
function parseStationInput(name, url, stations = []) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  const cleanUrl = String(url || '').trim();
  if (stations.length >= MAX_STATIONS) throw new Error(`At most ${MAX_STATIONS} custom stations are allowed. Remove one first.`);
  if (!cleanName || cleanName.length > MAX_STATION_NAME) throw new Error(`The station name needs 1–${MAX_STATION_NAME} characters.`);
  let parsed;
  try { parsed = new URL(cleanUrl); } catch { throw new Error('Enter a full stream URL starting with http:// or https://.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || cleanUrl.length > MAX_STATION_URL) throw new Error('Enter a full stream URL starting with http:// or https://.');
  if (stations.some(station => station.name.toLowerCase() === cleanName.toLowerCase())) throw new Error(`A station named "${cleanName}" already exists.`);
  if (stations.some(station => station.url === cleanUrl)) throw new Error('That stream URL is already in the list.');
  return { name: cleanName, url: cleanUrl };
}

function createVoiceEditor({ store, accessControl, env = {}, privilegedUserIds = env.PRIVILEGED_USER_IDS || new Set(),
  ttsClient = env.TTS_URL ? createTtsClient({ baseUrl: env.TTS_URL }) : null }) {
  const isPrivileged = userId => privilegedUserIds.has(String(userId || ''));

  // null when the TTS service is not configured or does not answer.
  async function loadVoices() {
    if (!ttsClient) return null;
    try {
      const voices = await ttsClient.listVoices();
      return Array.isArray(voices) ? voices.filter(voice => voice && typeof voice.id === 'string' && voice.id) : null;
    } catch {
      return null;
    }
  }

  function voiceOptions(voices, current) {
    return voices.slice(0, MAX_VOICE_OPTIONS).map(voice => ({
      label: String(voice.label || voice.id).slice(0, 100),
      value: voice.id.slice(0, 100),
      description: voice.id.slice(0, 100),
      default: voice.id === current
    }));
  }

  function voiceLabel(voices, voiceId) {
    const voice = voices?.find(entry => entry.id === voiceId);
    return voice?.label && voice.label !== voiceId ? `\`${voiceId}\` — ${voice.label}` : `\`${voiceId}\``;
  }

  async function render(guild, field = 'role', { note = '', mode = 'add', userId = null, viewerId = null } = {}) {
    if (!FIELDS.some(([key]) => key === field)) field = 'role';
    const label = FIELDS.find(([key]) => key === field)[1];
    const { tts, music } = store.getGuildConfig(guild.id);
    const privileged = isPrivileged(viewerId);
    const voices = ['voice', 'uservoices'].includes(field) ? await loadVoices() : null;
    const unavailable = !ttsClient ? 'The TTS service is not configured (TTS_URL), so no voices can be listed.' : 'The TTS service did not answer, so no voices can be listed. Try again later.';
    const userVoiceLines = Object.entries(tts.userVoices).map(([user, voice]) => `<@${user}> → \`${voice}\``);

    let detail;
    if (field === 'role') detail = `${tts.roleId ? `<@&${tts.roleId}>` : 'Not selected'}\nMembers with this role are read aloud in the bot's voice channel. Without a role, \`/tts\` creates or reuses one on first use.`;
    if (field === 'voice') detail = `${tts.voice ? voiceLabel(voices, tts.voice) : 'Service default'}${voices ? voices.length > MAX_VOICE_OPTIONS ? `\nShowing the first ${MAX_VOICE_OPTIONS} of ${voices.length} voices; use \`/tts voice\` for the others.` : '' : `\n${unavailable}`}`;
    if (field === 'uservoices') detail = `${fitLines(userVoiceLines, 'Nobody has a personal voice.')}\n\n${userId ? `Editing <@${userId}>: pick a voice below, or "Server voice" to reset.` : 'Choose a member to set or reset their voice.'}${voices ? '' : `\n${unavailable}`}`;
    if (field === 'follow') detail = `${fitLines(tts.followUserIds.map(user => `<@${user}>`), 'Nobody is followed.')}\n\nEvery message from followed users is read aloud while the bot is in a voice channel.${privileged ? '' : '\n🔒 Read-only: only the bot owners can change the follow list.'}`;
    if (field === 'channel') detail = `${music.controlChannelId ? `<#${music.controlChannelId}>` : 'Not selected'}\nThe music control panel is posted in this text channel.`;
    if (field === 'volume') detail = `${'▰'.repeat(Math.round(music.volume / 10))}${'▱'.repeat(10 - Math.round(music.volume / 10))} **${music.volume}%**\nApplies to music and radio playback.`;
    if (field === 'stations') detail = fitLines(music.stations.map((station, index) => `${index + 1}. **${station.name}** — ${station.url}`), 'No custom stations yet. Use Add station to add a stream URL.');

    const embed = new EmbedBuilder().setTitle('Admin • Voice (TTS & Music)').setColor(0x3498db)
      .setDescription(['Select a setting, then change it below. Changes save immediately.', note].filter(Boolean).join('\n\n'))
      .addFields(
        { name: 'TTS', value: `Role: ${tts.roleId ? `<@&${tts.roleId}>` : 'Not selected'}\nServer voice: ${tts.voice ? `\`${tts.voice}\`` : 'Service default'}\nPersonal voices: ${userVoiceLines.length} · Followed: ${tts.followUserIds.length}`, inline: true },
        { name: 'Music', value: `Control channel: ${music.controlChannelId ? `<#${music.controlChannelId}>` : 'Not selected'}\nVolume: ${music.volume}%\nCustom stations: ${music.stations.length}/${MAX_STATIONS}`, inline: true },
        { name: label, value: detail.slice(0, 1024) })
      .setFooter({ text: 'Only visible to you' });

    const settingMenu = new StringSelectMenuBuilder().setCustomId(id('field', field)).setPlaceholder('Choose a setting')
      .addOptions(FIELDS.map(([key, text]) => ({ label: text, value: key, default: key === field })));
    const rows = [row(settingMenu)];
    if (field === 'role') {
      const picker = new RoleSelectMenuBuilder().setCustomId(id('save', field)).setPlaceholder('Choose the TTS role').setMinValues(0).setMaxValues(1);
      if (tts.roleId) picker.setDefaultRoles(tts.roleId);
      rows.push(row(picker));
    }
    if (field === 'voice') {
      const menu = new StringSelectMenuBuilder().setCustomId(id('setvoice', field));
      if (voices?.length) menu.setPlaceholder('Choose the server voice').addOptions({ label: 'Service default', value: DEFAULT_VOICE_VALUE, description: 'Let the TTS service pick its default voice', default: !tts.voice }, ...voiceOptions(voices, tts.voice));
      else menu.setPlaceholder('TTS service unavailable').setDisabled(true).addOptions({ label: 'Unavailable', value: DEFAULT_VOICE_VALUE });
      rows.push(row(menu));
    }
    if (field === 'uservoices') {
      const picker = new UserSelectMenuBuilder().setCustomId(id('pickuser', field)).setPlaceholder('Choose a member').setMinValues(1).setMaxValues(1);
      if (userId) picker.setDefaultUsers(userId);
      rows.push(row(picker));
      if (userId) {
        const current = tts.userVoices[userId] || null;
        rows.push(row(new StringSelectMenuBuilder().setCustomId(id('uservoice', field, userId)).setPlaceholder('Choose a voice for this member')
          .addOptions({ label: 'Server voice (reset)', value: SERVER_VOICE_VALUE, description: 'Remove the personal voice', default: !current }, ...voiceOptions(voices || [], current))));
      }
    }
    if (field === 'follow' && privileged) {
      rows.push(row(new UserSelectMenuBuilder().setCustomId(id(mode === 'remove' ? 'removeitems' : 'save', field))
        .setPlaceholder(mode === 'remove' ? 'Remove from follow list' : 'Add to follow list').setMinValues(0).setMaxValues(25)));
      rows.push(row(button(id(mode === 'remove' ? 'open' : 'removemode', field), mode === 'remove' ? 'Add entries' : 'Remove entries')));
    }
    if (field === 'channel') {
      const picker = new ChannelSelectMenuBuilder().setCustomId(id('save', field)).setPlaceholder('Choose the music control channel')
        .addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
      if (music.controlChannelId) picker.setDefaultChannels(music.controlChannelId);
      rows.push(row(picker));
    }
    if (field === 'volume') {
      rows.push(row(new StringSelectMenuBuilder().setCustomId(id('setvolume', field)).setPlaceholder('Choose the playback volume')
        .addOptions(Array.from({ length: 11 }, (_, index) => index * 10).map(step => ({ label: `${step}%`, value: String(step), default: step === music.volume })))));
      rows.push(row(button(id('voldown', field), `-${VOLUME_STEP}`, ButtonStyle.Secondary, music.volume <= 0), button(id('volup', field), `+${VOLUME_STEP}`, ButtonStyle.Secondary, music.volume >= 100)));
    }
    if (field === 'stations') {
      if (music.stations.length) {
        rows.push(row(new StringSelectMenuBuilder().setCustomId(id('removestations', field)).setPlaceholder('Remove stations').setMinValues(1).setMaxValues(music.stations.length)
          .addOptions(music.stations.map(station => ({ label: station.name.slice(0, 100), value: stationKey(station), description: station.url.slice(0, 100) })))));
      }
      rows.push(row(button(id('addstation', field), 'Add station', ButtonStyle.Primary, music.stations.length >= MAX_STATIONS)));
    }
    rows.push(row(button(interactionIds.SETUP_VIEW_HOME_ID, 'Admin Overview')));
    return { content: null, embeds: [embed], components: rows, allowedMentions: { parse: [] } };
  }

  async function validateRole(guild, roleId) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === guild.id || role.managed) throw new Error('Choose a regular role from this server, not @everyone or a managed bot role.');
  }

  async function validateChannel(guild, channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Choose a text channel in this server.');
    const me = guild.members.me || await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'].filter(p => !permissions?.has(PermissionsBitField.Flags[p]));
    if (missing.length) throw new Error(`The bot needs ${missing.join(', ')} in that channel.`);
  }

  async function validateMembers(guild, values) {
    for (const value of values) if (!(await guild.members.fetch(value).catch(() => null))) throw new Error('Choose a member of this server.');
  }

  // Unknown ids are refused while the service answers; when it is down the id is kept, as /tts voice does.
  async function validateVoice(voiceId) {
    if (typeof voiceId !== 'string' || !/^[\w.-]{1,100}$/.test(voiceId)) throw new Error('Invalid voice.');
    const voices = await loadVoices();
    if (voices && !voices.some(voice => voice.id === voiceId)) throw new Error(`Unknown voice \`${voiceId}\`. Reopen the list and pick another one.`);
  }

  function selection(interaction, max) {
    const values = interaction.values;
    if (!Array.isArray(values) || values.length > max || values.some(value => !SNOWFLAKE.test(value))) throw new Error('Invalid selection.');
    return values;
  }

  const setTts = (guildId, changes) => store.setGuildConfig(guildId, { tts: { ...store.getGuildConfig(guildId).tts, ...changes } });
  const setMusic = (guildId, changes) => store.setGuildConfig(guildId, { music: { ...store.getGuildConfig(guildId).music, ...changes } });

  // Moving the control channel removes the old panel so the music feature posts a fresh one in the new channel.
  async function moveControlChannel(guild, channelId) {
    const { music } = store.getGuildConfig(guild.id);
    if (music.controlChannelId === channelId) return;
    if (music.controlChannelId && music.panelMessageId) {
      const channel = await guild.channels.fetch(music.controlChannelId).catch(() => null);
      const message = channel?.messages ? await channel.messages.fetch(music.panelMessageId).catch(() => null) : null;
      if (message && message.author?.id === guild.client?.user?.id) await message.delete().catch(() => null);
    }
    setMusic(guild.id, { controlChannelId: channelId, panelMessageId: null });
  }

  async function handle(interaction) {
    const customId = interaction.customId;
    if (typeof customId !== 'string' || !customId.startsWith('admin:')) return false;
    const [, action, section, requestedField, arg] = customId.split(':');
    if (section !== SECTION) return false;
    if (!(await accessControl.ensureSetupAccess(interaction, 'settings panel'))) return true;
    let field = FIELDS.some(([key]) => key === requestedField) ? requestedField : 'role';
    const guild = interaction.guild;
    const guildId = interaction.guildId;

    if (action === 'addstation' && store.getGuildConfig(guildId).music.stations.length < MAX_STATIONS) {
      await interaction.showModal(new ModalBuilder().setCustomId(id('savestation', 'stations')).setTitle('Add radio station').addComponents(
        row(new TextInputBuilder().setCustomId('name').setLabel('Station name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(MAX_STATION_NAME).setPlaceholder('Lofi Radio')),
        row(new TextInputBuilder().setCustomId('url').setLabel('Stream URL (http or https)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(MAX_STATION_URL).setPlaceholder('https://example.com/stream.mp3'))));
      return true;
    }

    // Rendering may wait up to 2 s for the TTS service, so every other action is deferred first.
    await interaction.deferUpdate();
    let note = '';
    let mode = 'add';
    let userId = null;
    try {
      if (action === 'field') {
        field = FIELDS.some(([key]) => key === interaction.values?.[0]) ? interaction.values[0] : field;
      } else if (action === 'removemode') {
        mode = 'remove';
        note = 'Select the entries to remove. Other entries stay unchanged.';
      } else if (action === 'open') {
        // Only renders.
      } else if ((action === 'save' || action === 'removeitems') && field === 'follow') {
        if (!isPrivileged(interaction.user?.id)) throw new Error('Only the bot owners can change the follow list.');
        const values = selection(interaction, 25);
        const current = store.getGuildConfig(guildId).tts.followUserIds;
        if (action === 'save') await validateMembers(guild, values);
        setTts(guildId, { followUserIds: action === 'removeitems' ? current.filter(user => !values.includes(user)) : [...new Set([...current, ...values])] });
        note = 'Saved.';
      } else if (action === 'save' && field === 'role') {
        const [roleId = null] = selection(interaction, 1);
        if (roleId) await validateRole(guild, roleId);
        setTts(guildId, { roleId });
        note = 'Saved.';
      } else if (action === 'save' && field === 'channel') {
        const [channelId = null] = selection(interaction, 1);
        if (channelId) await validateChannel(guild, channelId);
        await moveControlChannel(guild, channelId);
        note = 'Saved.';
      } else if (action === 'setvoice') {
        const value = interaction.values?.[0];
        if (value !== DEFAULT_VOICE_VALUE) await validateVoice(value);
        setTts(guildId, { voice: value === DEFAULT_VOICE_VALUE ? null : value });
        note = 'Saved.';
      } else if (action === 'pickuser') {
        [userId] = selection(interaction, 1);
        if (!userId) throw new Error('Choose a member.');
        await validateMembers(guild, [userId]);
      } else if (action === 'uservoice') {
        if (!SNOWFLAKE.test(arg || '')) throw new Error('Invalid member. Choose the member again.');
        userId = arg;
        const value = interaction.values?.[0];
        const userVoices = { ...store.getGuildConfig(guildId).tts.userVoices };
        if (value === SERVER_VOICE_VALUE) delete userVoices[userId];
        else { await validateVoice(value); userVoices[userId] = value; }
        setTts(guildId, { userVoices });
        note = value === SERVER_VOICE_VALUE ? `<@${userId}> uses the server voice again.` : `<@${userId}> now speaks with \`${value}\`.`;
      } else if (['setvolume', 'voldown', 'volup'].includes(action)) {
        const current = store.getGuildConfig(guildId).music.volume;
        const volume = clampVolume(action === 'setvolume' ? Number.parseInt(interaction.values?.[0], 10) : current + (action === 'volup' ? VOLUME_STEP : -VOLUME_STEP));
        setMusic(guildId, { volume });
        note = `Volume set to ${volume}%.`;
      } else if (action === 'savestation') {
        const { stations } = store.getGuildConfig(guildId).music;
        const station = parseStationInput(interaction.fields.getTextInputValue('name'), interaction.fields.getTextInputValue('url'), stations);
        setMusic(guildId, { stations: [...stations, station] });
        note = `Added **${station.name}**.`;
      } else if (action === 'removestations') {
        const keys = Array.isArray(interaction.values) ? interaction.values : [];
        const { stations } = store.getGuildConfig(guildId).music;
        const remaining = stations.filter(station => !keys.includes(stationKey(station)));
        if (remaining.length === stations.length) throw new Error('Those stations were already removed.');
        setMusic(guildId, { stations: remaining });
        note = `Removed ${stations.length - remaining.length} station${stations.length - remaining.length === 1 ? '' : 's'}.`;
      } else if (action === 'addstation') {
        throw new Error(`At most ${MAX_STATIONS} custom stations are allowed. Remove one first.`);
      } else {
        throw new Error('Unknown action. Reopen the panel.');
      }
    } catch (error) {
      note = `Could not finish: ${error.message}`;
    }
    await interaction.editReply(await render(guild, field, { note, mode, userId, viewerId: interaction.user?.id }));
    return true;
  }

  return { handle, render };
}

module.exports = { createVoiceEditor, parseStationInput, clampVolume, stationKey, MAX_STATIONS };
