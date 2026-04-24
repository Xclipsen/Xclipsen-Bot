const { EmbedBuilder } = require('discord.js');

function createHideonleafFeature({ store }) {
  async function handleHideonleafCommand(interaction) {
    const entries = store.listHideonleafStats()
      .filter((entry) => (
        entry.kills > 0 ||
        entry.totalShards > 0 ||
        entry.totalProfit > 0 ||
        entry.profitPerHour > 0
      ));

    if (entries.length === 0) {
      await interaction.reply({
        content: 'Es sind noch keine Hideonleaf-Daten vorhanden.',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x36C5F0)
      .setTitle('Hideonleaf Leaderboard')
      .setDescription('Top-Spieler nach Kills, Shards, Coins und Coins/h.')
      .addFields(
        {
          name: 'Kills',
          value: formatLeaderboard(entries, 'kills', (value) => formatInteger(value)),
          inline: true
        },
        {
          name: 'Shards',
          value: formatLeaderboard(entries, 'totalShards', (value) => formatInteger(value)),
          inline: true
        },
        {
          name: 'Money',
          value: formatLeaderboard(entries, 'totalProfit', (value) => formatCoins(value)),
          inline: true
        },
        {
          name: 'Money/h',
          value: formatLeaderboard(entries, 'profitPerHour', (value) => `${formatCoins(value)}/h`),
          inline: true
        }
      )
      .setFooter({ text: `Eintraege: ${entries.length}` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed] });
  }

  function formatLeaderboard(entries, key, formatter) {
    const ranked = [...entries]
      .sort((left, right) => {
        const valueDelta = Number(right[key] || 0) - Number(left[key] || 0);
        if (valueDelta !== 0) {
          return valueDelta;
        }

        return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
      })
      .slice(0, 10);

    if (ranked.length === 0 || ranked.every((entry) => Number(entry[key] || 0) <= 0)) {
      return 'Keine Daten';
    }

    return ranked
      .map((entry, index) => `\`${index + 1}.\` ${formatEntryName(store, entry)}: **${formatter(entry[key])}**`)
      .join('\n');
  }

  return {
    handleHideonleafCommand
  };
}

function formatEntryName(store, entry) {
  const linked = store.findBridgeLinkByMinecraftUsername(entry.minecraftUsername)?.entry || null;
  const discordName = String(
    linked?.discordDisplayName ||
    linked?.discordUsername ||
    ''
  ).trim();
  const minecraftName = String(
    linked?.preferredMinecraftUsername ||
    linked?.minecraftUsernames?.[0] ||
    entry.minecraftUsername ||
    ''
  ).trim();

  if (discordName && minecraftName && discordName.toLowerCase() !== minecraftName.toLowerCase()) {
    return `${discordName} (${minecraftName})`;
  }

  return discordName || minecraftName || 'Unknown user';
}

function formatCoins(value) {
  const numeric = Math.max(0, Number(value) || 0);
  if (numeric >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(1)}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K`;
  }
  return formatInteger(numeric);
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(Math.max(0, Number(value) || 0));
}

module.exports = { createHideonleafFeature };
