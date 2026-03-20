const { EmbedBuilder } = require('discord.js');

function createPlayerUuidFeature({ minecraft }) {
  function buildPlayerUuidEmbed(player) {
    const uuidData = minecraft.getUuidData(player.uuid);
    const formattedUuid = minecraft.formatUuid(player.uuid);

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('UUID Data')
      .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/256`)
      .setDescription([
        `Name: \`${player.name}\``,
        `UUID: \`${formattedUuid}\``,
        `Better Than: \`${uuidData.betterThanPercent}%\``,
        `Position: \`#${new Intl.NumberFormat('en-US').format(uuidData.position)}\``
      ].join('\n'))
      .setFooter({ text: 'Data from the Mojang API' })
      .setTimestamp();
  }

  async function handlePlayerUuidCommand(interaction) {
    const player = interaction.options.getString('player', true).trim();

    await interaction.deferReply();

    try {
      const profile = await minecraft.resolvePlayerProfile(player);
      await interaction.editReply({ embeds: [buildPlayerUuidEmbed(profile)] });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to fetch player UUID.'
      });
    }
  }

  return {
    handlePlayerUuidCommand
  };
}

module.exports = { createPlayerUuidFeature };
