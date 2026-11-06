const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, GlobalFonts, ImageData } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const MINECRAFT_COLORS = Object.freeze({
  0: '#000000',
  1: '#0000AA',
  2: '#00AA00',
  3: '#00AAAA',
  4: '#AA0000',
  5: '#AA00AA',
  6: '#FFAA00',
  7: '#AAAAAA',
  8: '#555555',
  9: '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFFFFF'
});

const COLOR_RGB = Object.fromEntries(Object.entries(MINECRAFT_COLORS).map(([code, hex]) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [code, [value >> 16, (value >> 8) & 0xff, value & 0xff]];
}));
const SHADOW_RGB = Object.fromEntries(Object.entries(COLOR_RGB).map(([code, rgb]) => [code, rgb.map((channel) => channel >> 2)]));

const DEFAULT_COLOR = 'f';
const LINE_HEIGHT = 10;
const TITLE_GAP = 2;
const GLYPH_HEIGHT = 8;
const BACKGROUND = [0x10, 0x00, 0x10, 0xf0];
const BORDER_TOP = [0x50, 0x00, 0xff, 0x50];
const BORDER_BOTTOM = [0x28, 0x00, 0x7f, 0x50];
const IGNORED_CHAR = /^[​-‏⁠-⁤︀-️﻿]$/u;
const MAX_OUTPUT_PIXELS = 40_000_000;

// Everything is composed on a grid of half GUI pixels so Unifont glyphs keep their native resolution.
const SUB = 2;

const FONTS = [
  // Minecraft.otf: 2 font units per pixel, outlines start half a pixel right of the pen.
  { family: 'MinecraftTooltipText', file: 'Minecraft.otf', size: 9, offsetX: -0.5, ascent: 7, unit: 2, offset: 2 },
  // Unifont glyphs are 16 px tall and drawn at half size, trimmed and offset like Minecraft's unihex provider.
  { family: 'MinecraftTooltipUnifont', file: 'unifont-18.0.01-subset.otf', size: 16, offsetX: 0, ascent: 14, unit: 1, offset: 1 }
];

const RASTER_SIZE = 64;
const RASTER_PAD = 16;

const MISSING_GLYPH = createMissingGlyph();

let state = null;

function readCodePoints(buffer) {
  const tableCount = buffer.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16;
    if (buffer.toString('latin1', record, record + 4) === 'cmap') cmap = buffer.readUInt32BE(record + 8);
  }
  if (cmap < 0) throw new Error('Font has no cmap table');
  const codePoints = new Set();
  const subtableCount = buffer.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtableCount; i++) {
    const record = cmap + 4 + i * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const table = cmap + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(table);
    if (format === 4) readFormat4(buffer, table, codePoints);
    else if (format === 12) readFormat12(buffer, table, codePoints);
  }
  return codePoints;
}

function readFormat4(buffer, table, codePoints) {
  const segments = buffer.readUInt16BE(table + 6) / 2;
  const ends = table + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = buffer.readUInt16BE(ends + s * 2);
    const start = buffer.readUInt16BE(starts + s * 2);
    const delta = buffer.readUInt16BE(deltas + s * 2);
    const rangeOffsetAt = rangeOffsets + s * 2;
    const rangeOffset = buffer.readUInt16BE(rangeOffsetAt);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        glyph = buffer.readUInt16BE(rangeOffsetAt + rangeOffset + (code - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) codePoints.add(code);
    }
  }
}

function readFormat12(buffer, table, codePoints) {
  const groups = buffer.readUInt32BE(table + 12);
  for (let g = 0; g < groups; g++) {
    const record = table + 16 + g * 12;
    const start = buffer.readUInt32BE(record);
    const end = buffer.readUInt32BE(record + 4);
    const glyph = buffer.readUInt32BE(record + 8);
    for (let code = start; code <= end; code++) {
      if (glyph + code - start !== 0) codePoints.add(code);
    }
  }
}

function init() {
  if (state) return state;
  const fonts = FONTS.map((font) => {
    const file = path.join(FONT_DIR, font.file);
    if (!GlobalFonts.registerFromPath(file, font.family)) throw new Error(`Could not load tooltip font ${file}`);
    return { ...font, codePoints: readCodePoints(fs.readFileSync(file)) };
  });
  const canvas = createCanvas(RASTER_SIZE, RASTER_SIZE);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  state = { fonts, context, glyphs: new Map() };
  return state;
}

function createMissingGlyph() {
  const points = [];
  for (let y = 0; y < GLYPH_HEIGHT; y++) {
    for (let x = 0; x < 5; x++) {
      if (x === 0 || x === 4 || y === 0 || y === GLYPH_HEIGHT - 1) points.push(x, y);
    }
  }
  return toGlyph(points, 2, 6 * SUB, 2);
}

function toGlyph(points, unit, advance, offset) {
  const pixels = [];
  for (let i = 0; i < points.length; i += 2) {
    for (let dy = 0; dy < unit; dy++) {
      for (let dx = 0; dx < unit; dx++) pixels.push(points[i] * unit + dx, points[i + 1] * unit + dy);
    }
  }
  return { pixels: Int16Array.from(pixels), advance, shadow: offset, bold: offset };
}

function rasterize(font, char) {
  const { context } = state;
  context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
  context.font = `${font.size}px "${font.family}"`;
  context.fillText(char, RASTER_PAD + font.offsetX, RASTER_PAD + font.ascent);
  const measured = context.measureText(char).width;
  const { data } = context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE);
  const points = [];
  let left = Infinity;
  let right = -Infinity;
  for (let y = 0; y < RASTER_SIZE; y++) {
    for (let x = 0; x < RASTER_SIZE; x++) {
      if (data[(y * RASTER_SIZE + x) * 4 + 3] < 128) continue;
      points.push(x - RASTER_PAD, y - RASTER_PAD);
      left = Math.min(left, x - RASTER_PAD);
      right = Math.max(right, x - RASTER_PAD);
    }
  }
  if (font.unit === 2) return toGlyph(points, 2, Math.floor(measured) * SUB, font.offset);
  if (!points.length) return toGlyph(points, 1, Math.round(measured), font.offset);
  for (let i = 0; i < points.length; i += 2) points[i] -= left;
  return toGlyph(points, 1, (Math.floor((right - left + 1) / 2) + 1) * SUB, font.offset);
}

function getGlyph(codePoint) {
  const cached = state.glyphs.get(codePoint);
  if (cached) return cached;
  const font = state.fonts.find((candidate) => candidate.codePoints.has(codePoint));
  if (!font) return MISSING_GLYPH;
  const glyph = rasterize(font, String.fromCodePoint(codePoint));
  state.glyphs.set(codePoint, glyph);
  return glyph;
}

function parseLine(line) {
  const chars = Array.from(String(line ?? ''));
  const parsed = [];
  let color = DEFAULT_COLOR;
  let bold = false;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '§') {
      if (i + 1 >= chars.length) break;
      const code = chars[++i].toLowerCase();
      if (Object.hasOwn(MINECRAFT_COLORS, code)) {
        color = code;
        bold = false;
      } else if (code === 'l') {
        bold = true;
      } else if (code === 'r') {
        color = DEFAULT_COLOR;
        bold = false;
      }
      continue;
    }
    if (IGNORED_CHAR.test(char)) continue;
    parsed.push({ glyph: getGlyph(char.codePointAt(0)), color, bold });
  }
  return parsed;
}

function layoutTooltip(lines) {
  const parsed = (lines.length ? lines : ['']).map(parseLine);
  let width = 0;
  for (const line of parsed) {
    let lineWidth = 0;
    for (const { glyph, bold } of line) lineWidth += glyph.advance + (bold ? glyph.bold : 0);
    width = Math.max(width, lineWidth);
  }
  return {
    lines: parsed,
    width: Math.ceil(width / SUB),
    height: parsed.length === 1 ? GLYPH_HEIGHT : parsed.length * LINE_HEIGHT
  };
}

function blendRect(surface, x, y, width, height, [r, g, b, a]) {
  const alpha = a / 255;
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      const i = (row * surface.width + column) * 4;
      const { data } = surface;
      const below = (data[i + 3] / 255) * (1 - alpha);
      const out = alpha + below;
      data[i] = Math.round((r * alpha + data[i] * below) / out);
      data[i + 1] = Math.round((g * alpha + data[i + 1] * below) / out);
      data[i + 2] = Math.round((b * alpha + data[i + 2] * below) / out);
      data[i + 3] = Math.round(out * 255);
    }
  }
}

function fillGui(surface, x, y, width, height, rgba) {
  blendRect(surface, x * SUB, y * SUB, width * SUB, height * SUB, rgba);
}

function drawBackground(surface, x, y, width, height) {
  fillGui(surface, x - 3, y - 4, width + 6, 1, BACKGROUND);
  fillGui(surface, x - 3, y + height + 3, width + 6, 1, BACKGROUND);
  fillGui(surface, x - 3, y - 3, width + 6, height + 6, BACKGROUND);
  fillGui(surface, x - 4, y - 3, 1, height + 6, BACKGROUND);
  fillGui(surface, x + width + 3, y - 3, 1, height + 6, BACKGROUND);
  fillGui(surface, x - 3, y - 3, width + 6, 1, BORDER_TOP);
  fillGui(surface, x - 3, y + height + 2, width + 6, 1, BORDER_BOTTOM);
  const rows = (height + 4) * SUB;
  for (let row = 0; row < rows; row++) {
    const t = (row + 0.5) / rows;
    const color = BORDER_TOP.map((top, channel) => Math.round(top + (BORDER_BOTTOM[channel] - top) * t));
    const top = (y - 2) * SUB + row;
    blendRect(surface, (x - 3) * SUB, top, SUB, 1, color);
    blendRect(surface, (x + width + 2) * SUB, top, SUB, 1, color);
  }
}

function drawGlyph(surface, glyph, x, y, [r, g, b]) {
  const { pixels } = glyph;
  const { data } = surface;
  for (let p = 0; p < pixels.length; p += 2) {
    const px = x + pixels[p];
    const py = y + pixels[p + 1];
    if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) continue;
    const i = (py * surface.width + px) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
}

function drawText(surface, tooltip, x, y, shadow) {
  tooltip.lines.forEach((line, index) => {
    const top = (y + index * LINE_HEIGHT + (index > 0 ? TITLE_GAP : 0)) * SUB;
    let pen = x * SUB;
    for (const { glyph, color, bold } of line) {
      const offset = shadow ? glyph.shadow : 0;
      const rgb = shadow ? SHADOW_RGB[color] : COLOR_RGB[color];
      drawGlyph(surface, glyph, pen + offset, top + offset, rgb);
      if (bold) drawGlyph(surface, glyph, pen + glyph.bold + offset, top + offset, rgb);
      pen += glyph.advance + (bold ? glyph.bold : 0);
    }
  });
}

function upscale(surface, scale) {
  const width = (surface.width / SUB) * scale;
  const height = (surface.height / SUB) * scale;
  const source = new Uint32Array(surface.data.buffer);
  const output = new Uint32Array(width * height);
  const columns = Int32Array.from({ length: width }, (_, x) => Math.floor((x * SUB) / scale));
  for (let y = 0; y < height; y++) {
    const sourceRow = Math.floor((y * SUB) / scale) * surface.width;
    const outputRow = y * width;
    for (let x = 0; x < width; x++) output[outputRow + x] = source[sourceRow + columns[x]];
  }
  return { width, height, data: new Uint8ClampedArray(output.buffer) };
}

async function renderTooltips(tooltips, { scale = 3, gap = 8, direction = 'row' } = {}) {
  if (!Array.isArray(tooltips) || !tooltips.length || !tooltips.every(Array.isArray)) {
    throw new TypeError('renderTooltips expects a non-empty array of line arrays');
  }
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new RangeError('scale must be an integer from 1 to 16');
  if (!Number.isInteger(gap) || gap < 0 || gap > 256) throw new RangeError('gap must be an integer from 0 to 256');
  if (direction !== 'row' && direction !== 'column') throw new RangeError("direction must be 'row' or 'column'");
  init();
  const layouts = tooltips.map(layoutTooltip);
  const stacked = direction === 'column';
  const spacing = gap * (layouts.length - 1);
  const width = stacked
    ? Math.max(...layouts.map((layout) => layout.width + 8))
    : layouts.reduce((sum, layout) => sum + layout.width + 8, 0) + spacing;
  const height = stacked
    ? layouts.reduce((sum, layout) => sum + layout.height + 8, 0) + spacing
    : Math.max(...layouts.map((layout) => layout.height + 8));
  if (width * height * scale * scale > MAX_OUTPUT_PIXELS) throw new RangeError('Tooltip image would be too large');
  const surface = { width: width * SUB, height: height * SUB, data: new Uint8ClampedArray(width * height * SUB * SUB * 4) };
  let left = 0;
  let top = 0;
  for (const layout of layouts) {
    const x = left + 4;
    const y = top + 4;
    drawBackground(surface, x, y, layout.width, layout.height);
    drawText(surface, layout, x, y, true);
    drawText(surface, layout, x, y, false);
    if (stacked) top += layout.height + 8 + gap;
    else left += layout.width + 8 + gap;
  }
  const image = upscale(surface, scale);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.encode('png');
}

module.exports = { renderTooltips, MINECRAFT_COLORS };
