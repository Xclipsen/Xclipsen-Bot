const path = require('node:path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');

const {
  cleanupTempDirectory,
  convertImageToGif,
  convertVideoToGif,
  createTempDirectory,
  downloadAttachment,
  getOutputBasename,
  isSupportedImageAttachment,
  isSupportedVideoAttachment
} = require('../utils/media');

// Discord's upload limit without boosts; interactions report the real one for their guild.
const DEFAULT_ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024;

function createGifFeature() {
  async function handleGifCommand(interaction) {
    const media = interaction.options.getAttachment('media', true);
    const isVideo = isSupportedVideoAttachment(media);

    if (!isVideo && !isSupportedImageAttachment(media)) {
      await interaction.reply({
        content: 'Please upload an image or a video for `/gif`.',
        flags: MessageFlags.Ephemeral
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

      if (isVideo) {
        await convertVideoToGif(inputPath, outputPath, {
          maxBytes: interaction.attachmentSizeLimit || DEFAULT_ATTACHMENT_SIZE_LIMIT
        });
      } else {
        await convertImageToGif(inputPath, outputPath);
      }

      await interaction.editReply({
        files: [new AttachmentBuilder(outputPath, { name: outputName })]
      });
    } catch (error) {
      await interaction.editReply({
        content: error.message || 'Failed to convert that file into a GIF.'
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
