const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { env } = require('../config/env');

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const MAGICK_BINARY = env.MAGICK_PATH || 'magick';
const FFMPEG_BINARY = 'ffmpeg';

// Longer clips are cut; each step trades quality for size until the GIF fits the upload limit.
const MAX_VIDEO_GIF_SECONDS = 30;
const VIDEO_GIF_STEPS = [
  { fps: 15, width: 480, colors: 256 },
  { fps: 12, width: 360, colors: 192 },
  { fps: 10, width: 320, colors: 128 },
  { fps: 8, width: 240, colors: 96 }
];

function getAttachmentExtension(attachment) {
  const attachmentName = String(attachment?.name || '').trim();
  const extension = path.extname(attachmentName).toLowerCase();

  if (extension) {
    return extension;
  }

  const contentType = String(attachment?.contentType || '').toLowerCase();
  if (contentType === 'image/gif') {
    return '.gif';
  }

  if (contentType === 'image/png') {
    return '.png';
  }

  if (contentType === 'image/webp') {
    return '.webp';
  }

  if (contentType === 'image/avif') {
    return '.avif';
  }

  if (contentType === 'image/jpeg') {
    return '.jpg';
  }

  if (contentType === 'video/mp4') {
    return '.mp4';
  }

  if (contentType === 'video/quicktime') {
    return '.mov';
  }

  if (contentType === 'video/webm') {
    return '.webm';
  }

  return '.bin';
}

function isSupportedImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  const extension = getAttachmentExtension(attachment);

  return contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
}

function isSupportedVideoAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  const extension = getAttachmentExtension(attachment);

  return contentType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension);
}

function getOutputBasename(attachment) {
  const rawName = path.parse(String(attachment?.name || 'output')).name || 'output';
  return rawName.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'output';
}

async function createTempDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function cleanupTempDirectory(tempDirectoryPath) {
  if (!tempDirectoryPath) {
    return;
  }

  await fs.rm(tempDirectoryPath, { recursive: true, force: true }).catch(() => {});
}

async function downloadAttachment(attachment, tempDirectoryPath, fileNamePrefix = 'input') {
  const sourceUrl = String(attachment?.url || '').trim();
  if (!sourceUrl) {
    throw new Error('Attachment URL is missing.');
  }

  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': env.USER_AGENT }
  });

  if (!response.ok) {
    throw new Error(`Failed to download attachment (${response.status}).`);
  }

  const sourcePath = path.join(tempDirectoryPath, `${fileNamePrefix}${getAttachmentExtension(attachment)}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(sourcePath, buffer);
  return sourcePath;
}

async function runCommand(command, args, options = {}) {
  try {
    await execFileAsync(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: options.timeout || 120000
    });
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '').trim();

    // A missing coder or delegate shows up as "no decode delegate" or as an unreadable magick-* temp file.
    if (/no decode delegate|unable to open file '[^']*magick-/i.test(stderr)) {
      throw new Error('This image format is not supported. Please try a PNG, JPG, WebP or GIF.');
    }

    const details = stderr.split('\n').filter(Boolean).slice(-1)[0] || 'unknown media processing failure';
    throw new Error(`Media processing failed: ${details}`);
  }
}

async function convertImageToGif(inputPath, outputPath) {
  await runCommand(MAGICK_BINARY, [
    inputPath,
    '-coalesce',
    '-layers', 'Optimize',
    '-loop', '0',
    outputPath
  ]);
}

function buildVideoGifArgs(inputPath, outputPath, { fps, width, colors }) {
  const filter = [
    `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b]`,
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p]`,
    '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  ].join(';');

  return [
    '-v', 'error',
    '-y',
    '-t', String(MAX_VIDEO_GIF_SECONDS),
    '-i', inputPath,
    '-filter_complex', filter,
    '-loop', '0',
    outputPath
  ];
}

async function convertVideoToGif(inputPath, outputPath, { maxBytes = Infinity } = {}) {
  for (const step of VIDEO_GIF_STEPS) {
    await runCommand(FFMPEG_BINARY, buildVideoGifArgs(inputPath, outputPath, step), { timeout: 180000 });

    const { size } = await fs.stat(outputPath);
    if (size <= maxBytes) {
      return;
    }
  }

  throw new Error('That video is too long to fit into a GIF under the upload limit. Try a shorter clip.');
}

module.exports = {
  buildVideoGifArgs,
  cleanupTempDirectory,
  convertImageToGif,
  convertVideoToGif,
  createTempDirectory,
  downloadAttachment,
  getOutputBasename,
  isSupportedImageAttachment,
  isSupportedVideoAttachment
};
