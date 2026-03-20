const { EmbedBuilder, MessageFlags } = require('discord.js');

const { helpSections, getHelpSectionById } = require('../config/help');

function createHelpFeature() {
  function buildOverviewEmbed() {
    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Help')
      .setDescription('Use `/help section:<name>` to jump to a specific category. Commands marked as admin-only need `Manage Server` or a whitelisted admin ID.')
      .addFields(
        ...helpSections.map((section) => ({
          name: section.label,
          value: `${section.summary}\nExamples: ${section.commands.slice(0, 2).map((command) => `\`${command.example}\``).join(', ')}`,
          inline: false
        }))
      )
      .setFooter({ text: 'Start with Player Tools for public utility commands.' });
  }

  function buildSectionEmbed(section) {
    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`Help - ${section.label}`)
      .setDescription(section.summary)
      .addFields(
        ...section.commands.map((command) => ({
          name: command.command,
          value: `${command.description}\nExample: \`${command.example}\`${command.adminOnly ? '\nAdmin-only.' : ''}`,
          inline: false
        }))
      )
      .setFooter({ text: 'Use /help without a section to see every category.' });
  }

  async function handleHelpCommand(interaction) {
    const sectionId = interaction.options.getString('section');
    const section = sectionId ? getHelpSectionById(sectionId) : null;

    await interaction.reply({
      embeds: [section ? buildSectionEmbed(section) : buildOverviewEmbed()],
      flags: MessageFlags.Ephemeral
    });
  }

  return {
    handleHelpCommand
  };
}

module.exports = { createHelpFeature };
