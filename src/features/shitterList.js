const { EmbedBuilder, MessageFlags } = require('discord.js');

const SHITTER_YES_COLOR = 0xc0392b;
const SHITTER_NO_COLOR = 0x2ecc71;

function buildEntryEmbed({ ign, status, reason = null, createdAt = null, screenshotUrl = null, screenshotName = null }) {
  const isListed = status === 'yes';
  const embed = new EmbedBuilder()
    .setColor(isListed ? SHITTER_YES_COLOR : SHITTER_NO_COLOR)
    .setTitle(`Shitter Check: ${ign}`)
    .addFields({ name: 'Shitter status', value: status, inline: true });

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason.slice(0, 1024), inline: false });
  }

  if (createdAt) {
    embed.addFields({ name: 'Geshittet am', value: formatTimestamp(createdAt), inline: true });
  }

  if (screenshotUrl) {
    embed.addFields({
      name: 'Screenshot',
      value: `[${screenshotName || 'Anhang offnen'}](${screenshotUrl})`,
      inline: false
    });
    embed.setImage(screenshotUrl);
  }

  return embed;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

function createShitterListFeature({ store, ensureSetupAccess }) {
  function normalizeIgn(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getEntry(guildId, ign) {
    const normalizedIgn = normalizeIgn(ign);
    return store.getShitterEntries(guildId).find((entry) => entry.normalizedIgn === normalizedIgn) || null;
  }

  async function handleShitterAddCommand(interaction) {
    if (!(await ensureSetupAccess(interaction, 'shitter add command'))) {
      return;
    }

    const ign = interaction.options.getString('name', true).trim();
    const reason = interaction.options.getString('reason', true).trim();
    const screenshot = interaction.options.getAttachment('screenshot');

    if (!ign) {
      await interaction.reply({
        content: 'IGN darf nicht leer sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!reason) {
      await interaction.reply({
        content: 'Reason darf nicht leer sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (screenshot && !String(screenshot.contentType || '').startsWith('image/')) {
      await interaction.reply({
        content: 'Der Screenshot muss ein Bild sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const normalizedIgn = normalizeIgn(ign);
    const existingEntries = store.getShitterEntries(interaction.guildId);
    const now = new Date().toISOString();
    const nextEntries = existingEntries.filter((entry) => entry.normalizedIgn !== normalizedIgn);

    nextEntries.push({
      ign,
      normalizedIgn,
      reason,
      createdAt: now,
      screenshotUrl: screenshot?.url || null,
      screenshotName: screenshot?.name || null,
      addedByUserId: interaction.user.id
    });

    store.setShitterEntries(interaction.guildId, nextEntries);

    await interaction.reply({
      content: `IGN \`${ign}\` wurde zur Shitter-Liste hinzugefugt.`,
      embeds: [buildEntryEmbed({
        ign,
        status: 'yes',
        reason,
        createdAt: now,
        screenshotUrl: screenshot?.url || null,
        screenshotName: screenshot?.name || null
      })],
      flags: MessageFlags.Ephemeral
    });
  }

  async function handleShitterQueryCommand(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Dieser Command kann nur auf einem Server genutzt werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const ign = interaction.options.getString('name', true).trim();
    const entry = getEntry(interaction.guildId, ign);

    if (!entry) {
      await interaction.reply({
        embeds: [buildEntryEmbed({ ign, status: 'no' })],
        allowedMentions: { parse: [] }
      });
      return;
    }

    await interaction.reply({
      embeds: [buildEntryEmbed({
        ign: entry.ign,
        status: 'yes',
        reason: entry.reason,
        createdAt: entry.createdAt,
        screenshotUrl: entry.screenshotUrl,
        screenshotName: entry.screenshotName
      })],
      allowedMentions: { parse: [] }
    });
  }

  return {
    handleShitterAddCommand,
    handleShitterQueryCommand,
    getEntry
  };
}

module.exports = { createShitterListFeature };
