const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { randomBytes } = require('node:crypto');
function paginateLines(lines, limit = 3500) {
  const pages = [];
  let page = '';
  for (const raw of lines) {
    let line = String(raw);
    while (line.length > limit) {
      if (page) { pages.push(page); page = ''; }
      pages.push(line.slice(0, limit)); line = line.slice(limit);
    }
    if (page && page.length + line.length + 1 > limit) { pages.push(page); page = ''; }
    page += (page ? '\n' : '') + line;
  }
  if (page || !pages.length) pages.push(page || 'No entries.');
  return pages;
}
function createPagedLists() {
  const sessions = new Map();
  function render(token, page) {
    const session = sessions.get(token);
    page = Math.max(0, Math.min(session.pages.length - 1, page));
    const controls = [
      new ButtonBuilder().setCustomId(`list:${token}:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`list:${token}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === session.pages.length - 1)
    ];
    if (session.back) controls.push(new ButtonBuilder().setCustomId(session.back).setLabel('Back').setStyle(ButtonStyle.Secondary));
    return { content: null, embeds: [new EmbedBuilder().setTitle(session.title).setDescription(session.pages[page]).setColor(0x3498db)
      .setFooter({ text: `Page ${page + 1}/${session.pages.length} • ${session.count} entries` })], components: [new ActionRowBuilder().addComponents(...controls)], allowedMentions: { parse: [] } };
  }
  async function open(interaction, { title, lines, back, guard, update = true }) {
    for (const [token, session] of sessions) if (session.expires < Date.now()) sessions.delete(token);
    if (sessions.size >= 500) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(8).toString('hex');
    sessions.set(token, { title, pages: paginateLines(lines), count: lines.length, back, guard, owner: interaction.user.id, guildId: interaction.guildId, expires: Date.now() + 30 * 60_000 });
    const payload = render(token, 0);
    if (update) await interaction.update(payload);
    else if (interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  async function handle(interaction) {
    if (!interaction.customId?.startsWith('list:')) return false;
    const [, token, rawPage] = interaction.customId.split(':');
    const session = sessions.get(token);
    if (!session || session.expires < Date.now() || session.owner !== interaction.user.id || session.guildId !== interaction.guildId) {
      await interaction.reply({ content: 'This list expired or belongs to another user. Open your own list again.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.guard && !(await session.guard(interaction, 'list'))) return true;
    await interaction.update(render(token, Number.isFinite(Number(rawPage)) ? Number(rawPage) : 0));
    return true;
  }
  return { open, handle };
}
module.exports = { createPagedLists, paginateLines };
