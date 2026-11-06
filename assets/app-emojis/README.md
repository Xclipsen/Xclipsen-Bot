# Application emojis

Icons the bot uploads as Discord **application emojis** (owned by the bot, usable in every guild and in
interaction replies). `src/utils/appEmojis.js` reads `manifest.json` on start, uploads every entry that
the application does not have yet and never deletes or replaces existing ones. Until the upload is done,
or if it fails, the bot shows the Unicode fallback emojis instead.

`manifest.json` maps the emoji name (`[a-z0-9_]`, 2-32 characters) to its `file` in this folder and the
`source` it was taken from; item icons also record the SkyBlock `itemId`.

| Prefix | Used for | Source |
| --- | --- | --- |
| `sb_` | Calendar events (`src/config/eventDefinitions.js`, `icon`) and the Mayor Alerts panel role | SkyBlock item icons from [Altpapier/Skyblock-Item-Emojis](https://github.com/Altpapier/Skyblock-Item-Emojis) (`v3/itemHash.json` → `v3/emojis.json`, static `normal` variant, 128 px). Textures are mostly from the [FurfSky Reborn](https://furfsky.net/) resource pack. |
| `mine_` | Mining events and islands (`src/config/miningEventDefinitions.js`) | Same as `sb_` |
| `weather_` | Weather tiers and clear weather (`src/config/weatherDefinitions.js`, `src/features/weather.js`) | Same as `sb_` |
| `dungeon_`, `boss_` | `/cata` overview lines and boss collections (`src/features/catacombs.js`) | Same as `sb_` |
| `mayor_` | Mayor heads (`env.MAYOR_HEADS`) | Isometric head renders from [mc-heads.net](https://mc-heads.net/) of the in-game NPC skin textures, trimmed and downscaled to 128 px |

All files are 128×128 RGBA PNGs with a transparent background and no metadata. Item icons were
re-encoded unchanged (non-square ones centred on a transparent 128×128 canvas, nearest-neighbour only);
the 256 px head renders were trimmed and box-filtered down to 128 px, which keeps the non-integer
downscale free of stray pixels.

## Adding an icon

1. Download the source image into a fresh temporary folder and check it really is an image
   (`file`, `magick identify`).
2. Convert it, e.g. for a SkyBlock item icon:
   `magick 'png:SOURCE[0]' -strip -filter point -resize '128x128>' -background none -gravity center -extent 128x128 png32:assets/app-emojis/sb_example.png`
   (at most 256 KB, PNG or GIF).
3. Add `"sb_example": { "file": "sb_example.png", "itemId": "…", "source": "…" }` to `manifest.json`.
4. Use it via `appEmojis.get('sb_example', '🎉')` (or set `icon: 'sb_example'` on an event definition).
   The next bot start uploads it.

Renaming or replacing the image of an existing emoji is not picked up automatically, because uploads
are matched by name: delete the old emoji in the Discord developer portal (Application → Emojis) or use
a new name.
