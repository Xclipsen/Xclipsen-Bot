const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const MAGICK_BINARY_CANDIDATES = [
  process.env.MAGICK_PATH,
  '/usr/bin/magick',
  '/usr/local/bin/magick',
  '/bin/magick',
  '/usr/bin/convert',
  '/usr/local/bin/convert',
  '/bin/convert',
  'magick',
  'convert'
];

function isExecutableFile(filePath) {
  try {
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveMagickBinary() {
  for (const candidate of MAGICK_BINARY_CANDIDATES) {
    if (!candidate) {
      continue;
    }

    if (!candidate.includes(path.sep)) {
      return candidate;
    }

    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  throw new Error('Required media binary is missing: magick');
}

const MAGICK_BINARY = resolveMagickBinary();

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

  return '.bin';
}

function isSupportedImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  const extension = getAttachmentExtension(attachment);

  return contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
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
    headers: { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' }
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

module.exports = {
  cleanupTempDirectory,
  convertImageToGif,
  createTempDirectory,
  downloadAttachment,
  getOutputBasename,
  isSupportedImageAttachment
};
