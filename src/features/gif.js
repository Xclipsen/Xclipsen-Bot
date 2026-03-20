const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

const {
  cleanupTempDirectory,
  convertImageToGif,
  createTempDirectory,
  downloadAttachment,
  getOutputBasename,
  isSupportedImageAttachment
} = require('../utils/media');

function createGifFeature() {
  async function handleGifCommand(interaction) {
    const media = interaction.options.getAttachment('media', true);

    if (!isSupportedImageAttachment(media)) {
      await interaction.reply({
        content: 'Please upload an image for `/gif`.',
        flags: 64
      });
      return;
    }

    await interaction.deferReply();

    let tempDirectoryPath;

    try {
      tempDirectoryPath = await createTempDirectory('xclipsen-gif-');

      const inputPath = await downloadAttachment(media, tempDirectoryPath, 'input');
      const outputName = `${getOutputBasename(media)}.gif`;
      const outputPath = path.join(tempDirectoryPath, outputName);

      await convertImageToGif(inputPath, outputPath);

      await interaction.editReply({
        files: [new AttachmentBuilder(outputPath, { name: outputName })]
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to convert that image into a GIF.'
      });
    } finally {
      await cleanupTempDirectory(tempDirectoryPath);
    }
  }

  return {
    handleGifCommand
  };
}

module.exports = { createGifFeature };
