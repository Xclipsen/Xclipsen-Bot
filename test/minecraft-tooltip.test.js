const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { renderTooltips, MINECRAFT_COLORS } = require('../src/utils/minecraftTooltip');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STAT_SYMBOLS = '☂α⛃♔☯☘⸕ൠ☀⌕✿❄⚡☾≈•❤❈❁✦☣☠✎⚔๑✯♣❂⫽♨☄✧⸙♲ϟ☽❣➜✖✔▲◆★♦♠♥☺';

function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function decode(png) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const pixel = (x, y) => {
    const i = (y * image.width + x) * 4;
    return { hex: `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`, alpha: data[i + 3] };
  };
  const find = (hex) => {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const p = pixel(x, y);
        if (p.alpha === 255 && p.hex === hex) return { x, y };
      }
    }
    return null;
  };
  const colors = () => {
    const found = new Set();
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const p = pixel(x, y);
        if (p.alpha === 255) found.add(p.hex);
      }
    }
    return found;
  };
  return { width: image.width, height: image.height, pixel, find, colors };
}

function shadowOf(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `#${[value >> 16, (value >> 8) & 0xff, value & 0xff].map((v) => (v >> 2).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

async function width(line) {
  return pngSize(await renderTooltips([[line]], { scale: 1 })).width;
}

test('exports the Minecraft colour palette', () => {
  assert.equal(Object.keys(MINECRAFT_COLORS).length, 16);
  assert.equal(MINECRAFT_COLORS[7], '#AAAAAA');
  assert.equal(MINECRAFT_COLORS.d, '#FF55FF');
  assert.equal(MINECRAFT_COLORS.f, '#FFFFFF');
  assert.ok(Object.isFrozen(MINECRAFT_COLORS));
});

test('renders PNGs whose size follows scale, tooltip count and line count', async () => {
  const single = await renderTooltips([['A']]);
  assert.deepEqual(single.subarray(0, 8), PNG_SIGNATURE);
  assert.deepEqual(pngSize(single), { width: 14 * 3, height: 16 * 3 });
  assert.deepEqual(pngSize(await renderTooltips([['A']], { scale: 5 })), { width: 14 * 5, height: 16 * 5 });
  assert.deepEqual(pngSize(await renderTooltips([['A'], ['A', 'B', '']], { scale: 2 })), { width: (14 + 8 + 14) * 2, height: (30 + 8) * 2 });
  assert.deepEqual(pngSize(await renderTooltips([['A'], ['A']], { scale: 2, gap: 0 })), { width: 28 * 2, height: 16 * 2 });
  for (const lines of [2, 5, 13]) {
    const png = await renderTooltips([Array.from({ length: lines }, () => 'A')], { scale: 2 });
    assert.equal(pngSize(png).height, (lines * 10 + 8) * 2);
  }
});

test('stacks tooltips vertically with direction column', async () => {
  assert.deepEqual(pngSize(await renderTooltips([['A'], ['A', 'B', '']], { scale: 2, direction: 'column' })), { width: 14 * 2, height: (16 + 8 + 38) * 2 });
  assert.deepEqual(pngSize(await renderTooltips([['AAAA'], ['A']], { scale: 1, gap: 0, direction: 'column' })).height, 32);
  await assert.rejects(renderTooltips([['A']], { direction: 'diagonal' }), RangeError);
});

test('draws the notched vanilla background and border', async () => {
  const image = await decode(await renderTooltips([['A', 'B']], { scale: 2 }));
  assert.equal(image.pixel(0, 0).alpha, 0);
  assert.equal(image.pixel(image.width - 1, image.height - 1).alpha, 0);
  assert.ok(image.pixel(0, 2).alpha > 200);
  assert.ok(image.pixel(2, 0).alpha > 200);
  const background = image.pixel(6, 6);
  const border = image.pixel(2, 10);
  assert.ok(background.alpha >= 235 && background.alpha <= 245);
  assert.ok(Number.parseInt(border.hex.slice(5), 16) > Number.parseInt(background.hex.slice(5), 16) + 40);
});

test('places the title two pixels above the vanilla 10 px line grid', async () => {
  const image = await decode(await renderTooltips([['§c.', '§a.', '§e.']], { scale: 1 }));
  assert.deepEqual(image.find(MINECRAFT_COLORS.c), { x: 4, y: 10 });
  assert.deepEqual(image.find(MINECRAFT_COLORS.a), { x: 4, y: 22 });
  assert.deepEqual(image.find(MINECRAFT_COLORS.e), { x: 4, y: 32 });
});

test('parses colour, bold, reset and ignores unknown section codes', async () => {
  const red = (await decode(await renderTooltips([['§cA']]))).colors();
  assert.ok(red.has(MINECRAFT_COLORS.c));
  assert.ok(!red.has(MINECRAFT_COLORS.f));
  const plain = (await decode(await renderTooltips([['A']]))).colors();
  assert.ok(plain.has(MINECRAFT_COLORS.f));
  const reset = (await decode(await renderTooltips([['§cA§rB']]))).colors();
  assert.ok(reset.has(MINECRAFT_COLORS.c) && reset.has(MINECRAFT_COLORS.f));

  const base = await width('A');
  assert.equal(await width('§lA'), base + 1);
  assert.equal(await width('§l§cA'), base);
  assert.equal(await width('§lA§rA'), (await width('AA')) + 1);
  assert.equal(await width('§6§lGOLD'), (await width('GOLD')) + 4);

  const same = async (a, b) => assert.deepEqual(await renderTooltips([[a]]), await renderTooltips([[b]]));
  await same('§zA§kB§mC§nD§oE', 'ABCDE');
  await same('§CA', '§cA');
  await same('A§', 'A');
  await same('❄️', '❄');
});

test('every colour gets a quarter-brightness shadow one pixel down-right', async () => {
  for (const [code, hex] of Object.entries(MINECRAFT_COLORS)) {
    const image = await decode(await renderTooltips([[`§${code}.`]], { scale: 2 }));
    const glyph = image.find(hex);
    assert.ok(glyph, `glyph for §${code}`);
    assert.equal(image.pixel(glyph.x + 2, glyph.y + 2).hex, shadowOf(hex), `shadow for §${code}`);
  }
  const bold = await decode(await renderTooltips([['§e§l.']], { scale: 1 }));
  assert.equal(bold.pixel(4, 10).hex, MINECRAFT_COLORS.e);
  assert.equal(bold.pixel(5, 10).hex, MINECRAFT_COLORS.e);
  assert.equal(bold.pixel(6, 11).hex, '#3F3F15');
});

test('every Hypixel stat symbol is covered by a bundled font', async () => {
  const missing = await renderTooltips([['']], { scale: 2 });
  for (const symbol of STAT_SYMBOLS) {
    const png = await renderTooltips([[symbol]], { scale: 2 });
    assert.notDeepEqual(png, missing, `${symbol} (U+${symbol.codePointAt(0).toString(16).toUpperCase()}) falls back to the missing glyph`);
    assert.ok((await decode(png)).colors().has(MINECRAFT_COLORS.f), `${symbol} draws pixels`);
  }
  assert.equal(await width('A'), 14);
  assert.equal(await width('i'), 10);
});

test('unknown glyphs render as a box instead of throwing', async () => {
  const png = await renderTooltips([['§7Rain 🌧  \u{10ffff}', '§'], []], { scale: 2 });
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(await width(''), await width('\u{f0000}'));
});

test('rejects invalid input', async () => {
  await assert.rejects(renderTooltips([]), TypeError);
  await assert.rejects(renderTooltips(['not lines']), TypeError);
  await assert.rejects(renderTooltips([['A']], { scale: 0 }), RangeError);
  await assert.rejects(renderTooltips([['A']], { scale: 2.5 }), RangeError);
  await assert.rejects(renderTooltips([['A']], { gap: -1 }), RangeError);
});
