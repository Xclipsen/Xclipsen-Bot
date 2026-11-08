process.env.DISCORD_TOKEN ||= 'test-token';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  convertVideoToGif,
  isSupportedImageAttachment,
  isSupportedVideoAttachment
} = require('../src/utils/media');

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('video attachments are recognized by content type or extension', () => {
  assert.equal(isSupportedVideoAttachment({ name: 'clip.mp4', contentType: 'video/mp4' }), true);
  assert.equal(isSupportedVideoAttachment({ name: 'clip.MOV', contentType: null }), true);
  assert.equal(isSupportedVideoAttachment({ name: 'clip', contentType: 'video/webm' }), true);
  assert.equal(isSupportedVideoAttachment({ name: 'cat.png', contentType: 'image/png' }), false);
  assert.equal(isSupportedImageAttachment({ name: 'clip.mp4', contentType: 'video/mp4' }), false);
});

test('convertVideoToGif writes a looping GIF under the size limit', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.mp4');
  const outputPath = path.join(directory, 'output.gif');

  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2', '-pix_fmt', 'yuv420p', inputPath]);

  await convertVideoToGif(inputPath, outputPath, { maxBytes: 2 * 1024 * 1024 });

  const output = fs.readFileSync(outputPath);
  assert.equal(output.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(output.length <= 2 * 1024 * 1024);
});

test('convertVideoToGif fails when no step fits the size limit', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.mp4');

  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=1', '-pix_fmt', 'yuv420p', inputPath]);

  await assert.rejects(
    convertVideoToGif(inputPath, path.join(directory, 'output.gif'), { maxBytes: 1 }),
    /too long to fit into a GIF/
  );
});
