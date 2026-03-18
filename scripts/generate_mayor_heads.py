#!/usr/bin/env python3

import json
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageDraw


NPCS_URL = 'https://skyblock.matdoes.dev/skyblock-npcs.json'
TEXTURE_URL = 'https://textures.minecraft.net/texture/{hash}'
OUTPUT_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'mayor-heads'
OUTPUT_SIZE = 512

MAYOR_ALIASES = {
    'aatrox': ['Mayor Aatrox'],
    'cole': ['Mayor Cole'],
    'diana': ['Mayor Diana'],
    'diaz': ['Mayor Diaz'],
    'finnegan': ['Mayor Finnegan'],
    'foxy': ['Mayor Foxy'],
    'marina': ['Mayor Marina'],
    'paul': ['Mayor Paul'],
    'scorpius': ['Mayor Scorpius'],
    'seraphine': ['Mayor Seraphine'],
    'derpy': ['Mayor Derpy'],
    'jerry': ['Candidate Jerry', 'Mayor Jerry', 'Jerry']
}


def fetch_json(url):
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_image(url):
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    response.raise_for_status()
    return Image.open(BytesIO(response.content)).convert('RGBA')


def crop_head_parts(skin):
    face = skin.crop((8, 8, 16, 16)).convert('RGBA')
    top = skin.crop((8, 0, 16, 8)).convert('RGBA')
    side = skin.crop((0, 8, 8, 16)).convert('RGBA')

    hat_face = skin.crop((40, 8, 48, 16)).convert('RGBA')
    hat_top = skin.crop((40, 0, 48, 8)).convert('RGBA')
    hat_side = skin.crop((32, 8, 40, 16)).convert('RGBA')

    return {
        'face': face,
        'top': top,
        'side': side,
        'hat_face': hat_face,
        'hat_top': hat_top,
        'hat_side': hat_side,
    }


def project(point, ox, oy, px=10, py=5, vh=10):
    x, y, z = point
    return (ox + (x - z) * px, oy + (x + z) * py - y * vh)


def texel_polygon(face_name, tx, ty, ox, oy):
    if face_name == 'top':
        x0, x1 = tx, tx + 1
        z0, z1 = ty, ty + 1
        y = 8
        corners = [
            project((x0, y, z0), ox, oy),
            project((x1, y, z0), ox, oy),
            project((x1, y, z1), ox, oy),
            project((x0, y, z1), ox, oy),
        ]
    elif face_name == 'front':
        x0, x1 = tx, tx + 1
        y_top = 8 - ty
        y_bottom = 7 - ty
        z = 8
        corners = [
            project((x0, y_top, z), ox, oy),
            project((x1, y_top, z), ox, oy),
            project((x1, y_bottom, z), ox, oy),
            project((x0, y_bottom, z), ox, oy),
        ]
    else:
        z0 = 8 - (tx + 1)
        z1 = 8 - tx
        y_top = 8 - ty
        y_bottom = 7 - ty
        x = 8
        corners = [
            project((x, y_top, z0), ox, oy),
            project((x, y_top, z1), ox, oy),
            project((x, y_bottom, z1), ox, oy),
            project((x, y_bottom, z0), ox, oy),
        ]

    return corners


def draw_face(draw, image, face_name, texture, ox, oy):
    for ty in range(8):
        for tx in range(8):
            rgba = texture.getpixel((tx, ty))
            if rgba[3] == 0:
                continue
            draw.polygon(texel_polygon(face_name, tx, ty, ox, oy), fill=rgba)


def render_isometric_head(parts):
    canvas = Image.new('RGBA', (220, 220), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    ox = 110
    oy = 140

    draw_face(draw, canvas, 'top', parts['top'], ox, oy)
    draw_face(draw, canvas, 'side', parts['side'], ox, oy)
    draw_face(draw, canvas, 'front', parts['face'], ox, oy)

    draw_face(draw, canvas, 'top', parts['hat_top'], ox, oy)
    draw_face(draw, canvas, 'side', parts['hat_side'], ox, oy)
    draw_face(draw, canvas, 'front', parts['hat_face'], ox, oy)

    bbox = canvas.getbbox()
    cropped = canvas.crop(bbox)
    resized = cropped.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.NEAREST)
    return resized.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def render_flat_head(parts):
    base = parts['face'].copy()
    base.alpha_composite(parts['hat_face'])
    return base.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.NEAREST)


def build_texture_lookup(npcs):
    lookup = {}
    for npc in npcs:
        name = npc.get('name')
        texture = npc.get('texture')
        if name and texture and name not in lookup:
            lookup[name] = texture
    return lookup


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    npcs = fetch_json(NPCS_URL)
    lookup = build_texture_lookup(npcs)
    manifest = {}

    for mayor_key, aliases in MAYOR_ALIASES.items():
        texture_hash = next((lookup.get(alias) for alias in aliases if lookup.get(alias)), None)

        if not texture_hash:
            print(f'skip {mayor_key}: no texture found for aliases {aliases}')
            continue

        skin = fetch_image(TEXTURE_URL.format(hash=texture_hash))
        parts = crop_head_parts(skin)

        flat_path = OUTPUT_DIR / f'{mayor_key}-flat.png'
        iso_path = OUTPUT_DIR / f'{mayor_key}-iso.png'

        render_flat_head(parts).save(flat_path)
        render_isometric_head(parts).save(iso_path)

        manifest[mayor_key] = {
            'texture': texture_hash,
            'flat': str(flat_path.relative_to(OUTPUT_DIR.parents[1])),
            'iso': str(iso_path.relative_to(OUTPUT_DIR.parents[1]))
        }
        print(f'generated {mayor_key}')

    manifest_path = OUTPUT_DIR / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf8')
    print(f'wrote {manifest_path.relative_to(OUTPUT_DIR.parents[1])}')


if __name__ == '__main__':
    main()
