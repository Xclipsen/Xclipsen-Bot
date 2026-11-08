const path = require('node:path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');

const {
  cleanupTempDirectory,
  convertImageToGif,
  convertVideoToGif,
  createTempDirectory,
  downloadAttachment,
  downloadTweetVideo,
  getOutputBasename,
  getTweetId,
  isSupportedImageAttachment,
  isSupportedVideoAttachment
} = require('../utils/media');

// Discord's upload limit without boosts; interactions report the real one for their guild.
const DEFAULT_ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024;

function createGifFeature() {
  async function replyEphemeral(interaction, content) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  async function handleGifCommand(interaction) {
    const media = interaction.options.getAttachment('media');
    const link = interaction.options.getString('link');

    if (Boolean(media) === Boolean(link)) {
      await replyEphemeral(interaction, 'Use `/gif` with either `media` (an image or video) or `link` (a Twitter/X post), not both.');
      return;
    }

    const tweetId = link ? getTweetId(link) : null;
    if (link && !tweetId) {
      await replyEphemeral(interaction, 'Please paste a link to a Twitter/X post, like `https://x.com/user/status/123`.');
      return;
    }

    const isVideo = Boolean(tweetId) || isSupportedVideoAttachment(media);
    if (media && !isVideo && !isSupportedImageAttachment(media)) {
      await replyEphemeral(interaction, 'Please upload an image or a video for `/gif`.');
      return;
    }

    await interaction.deferReply();

    let tempDirectoryPath;

    try {
      tempDirectoryPath = await createTempDirectory('xclipsen-gif-');

      const inputPath = tweetId
        ? await downloadTweetVideo(tweetId, tempDirectoryPath)
        : await downloadAttachment(media, tempDirectoryPath, 'input');
      const outputName = tweetId ? `tweet-${tweetId}.gif` : `${getOutputBasename(media)}.gif`;
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
        content: error.message || 'Failed to convert that into a GIF.'
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
