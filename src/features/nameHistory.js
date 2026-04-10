const { EmbedBuilder } = require('discord.js');

function createNameHistoryFeature({ minecraft }) {
  function getHistorySourceText(profile) {
    return 'NameMC';
  }

  function formatDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  }

  function getPastNames(profile) {
    const currentName = String(profile.name || '').trim().toLowerCase();
    const seen = new Set();

    return profile.history
      .filter((entry) => {
        const normalizedName = String(entry?.name || '').trim().toLowerCase();
        if (!normalizedName || normalizedName === currentName || seen.has(normalizedName)) {
          return false;
        }

        seen.add(normalizedName);
        return true;
      })
      .sort((left, right) => {
        const leftTime = left?.changedAt ? new Date(left.changedAt).getTime() : Number.NEGATIVE_INFINITY;
        const rightTime = right?.changedAt ? new Date(right.changedAt).getTime() : Number.NEGATIVE_INFINITY;
        return rightTime - leftTime;
      });
  }

  function buildHistoryLines(profile) {
    const pastNames = getPastNames(profile);

    if (pastNames.length === 0) {
      return ['No previous names found.'];
    }

    return pastNames.map((entry, index) => {
      const changedAt = formatDate(entry.changedAt);

      if (changedAt) {
        return `${index + 1}. ${entry.name} (${changedAt})`;
      }

      return `${index + 1}. ${entry.name}`;
    });
  }

  function buildNameHistoryEmbed(profile) {
    const historyLines = buildHistoryLines(profile);
    const renameCount = getPastNames(profile).length;
    const createdAt = formatDate(profile.createdAt);
    const meta = [
      `Past Names: \`${renameCount}\``,
      `History Source: \`${getHistorySourceText(profile)}\``
    ];

    if (createdAt) {
      meta.push(`Account Created: \`${createdAt}\``);
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Name History')
      .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(profile.name)}/256`)
      .setDescription([
        `Current Name: \`${profile.name}\``,
        `UUID: \`${minecraft.formatUuid(profile.uuid)}\``,
        ...meta,
        '',
        '```text',
        ...historyLines,
        '```'
      ].join('\n'))
      .setFooter({
        text: 'Current profile from Mojang, history from NameMC'
      })
      .setTimestamp();
  }

  async function handleNameHistoryCommand(interaction) {
    const player = interaction.options.getString('player', true).trim();

    await interaction.deferReply();

    try {
      const profile = await minecraft.fetchNameHistory(player);
      await interaction.editReply({ embeds: [buildNameHistoryEmbed(profile)] });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to fetch name history.'
      });
    }
  }

  return {
    handleNameHistoryCommand
  };
}

module.exports = { createNameHistoryFeature };
