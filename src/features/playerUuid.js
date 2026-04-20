const { EmbedBuilder } = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');

function createPlayerUuidFeature({ minecraft, store }) {
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
    await interaction.deferReply();

    try {
      const { username, usedLinkedAccount } = resolveMinecraftUsernameOption({
        interaction,
        store,
        optionName: 'player',
        missingMessage: 'No player provided and no linked Minecraft username found. Use `/link start` first or pass `player:`.'
      });

      const player = username;
      const profile = await minecraft.resolvePlayerProfile(player);
      await interaction.editReply({
        content: usedLinkedAccount ? buildLinkedUsernameNotice(profile.name) : undefined,
        embeds: [buildPlayerUuidEmbed(profile)]
      });
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
