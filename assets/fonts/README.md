# Tooltip fonts

Used by `src/utils/minecraftTooltip.js` to render Minecraft-style item tooltips.

| File | Source | Version | License |
| --- | --- | --- | --- |
| `Minecraft.otf` | [IdreesInc/Minecraft-Font](https://github.com/IdreesInc/Minecraft-Font), release asset `Minecraft.otf` | v1.0 (2022-08-25), unmodified | SIL OFL 1.1, see `Minecraft-OFL.txt` (Copyright (c) 2022, Idrees Hassan) |
| `unifont-18.0.01-subset.otf` | [GNU Unifont](https://unifoundry.com/unifont/), `https://ftp.gnu.org/gnu/unifont/unifont-18.0.01/unifont-18.0.01.otf` (GPG signature verified) | 18.0.01, subset | Dual: SIL OFL 1.1 (used here, see `Unifont-OFL-1.1.txt`) or GPLv2+ with font embedding exception. Copyright © 1998-2026 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew Miller, Johnnie Weaver, David Corbett, et al. |

`Minecraft.otf` is a fan recreation of the Minecraft UI font and contains no Mojang assets. Unifont is the fallback for every character the main font lacks, as in Minecraft itself. Unifont declares no Reserved Font Name.

The Unifont subset was created with fontTools 4.67.0:

```bash
pyftsubset unifont-18.0.01.otf --layout-features='' --no-hinting --name-IDs='*' --name-languages='*' --notdef-outline \
  --unicodes='U+0000-024F,U+0250-02FF,U+0370-03FF,U+0400-04FF,U+0D00-0D7F,U+0E00-0E7F,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2460-24FF,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+27C0-27EF,U+27F0-27FF,U+2900-297F,U+2980-29FF,U+2A00-2AFF,U+2B00-2BFF,U+2E00-2E7F,U+FFF0-FFFF' \
  --output-file=unifont-18.0.01-subset.otf
```

Blocks: Latin (incl. Extended-A/B, IPA, spacing modifiers), Greek, Cyrillic, Malayalam, Thai, General Punctuation, super/subscripts, currency, Letterlike, Number Forms, Arrows (incl. supplemental), Mathematical Operators (incl. supplemental and misc A/B), Misc Technical, Enclosed Alphanumerics, Box Drawing, Block Elements, Geometric Shapes, Misc Symbols, Dingbats, Misc Symbols and Arrows, Supplemental Punctuation, Specials.

SHA-256: `Minecraft.otf` `ebc7a7be9f69479f02875af1fe79a2b93cc868b83be4f6369ecceb45fabe5ee6`; original `unifont-18.0.01.otf` `88d0a14d4aa9a96419720b39ba5da921a59560d76d4ec7d523acc06ed85cd3c2`; subset `6fd95a25c9b1ecfd14a309a11153ffba6dfd693f609ab4604575da81cf19190f`.
