# tts-service

Small self-hosted German text-to-speech HTTP service for the Xclipsen bot. Runs CPU-only as a second container in the compose project and is reachable internally as `http://tts:5000`.

Voices:

| id         | engine                           | notes                                  |
| ---------- | -------------------------------- | -------------------------------------- |
| `thorsten` | Piper `de_DE-thorsten-high`      | default, loaded at startup, ~300 MB    |
| `juergen`  | Kyutai Pocket TTS (`german`)     | loaded on first use, ~1 GB more RAM    |
| `jenny`, `alan` | Piper `en_GB-jenny_dioco-medium`, `en_GB-alan-medium` | English voices: English numbers and abbreviations, no German spelling list |
| `thorsten_whisper`, `_sleepy`, `_drunk`, `_angry`, `_amused`, `_surprised`, `_disgusted`, `_neutral` | Piper `de_DE-thorsten_emotional-medium` speakers | one shared model, ~80 MB for all eight |

Any `<id>.onnx` + `<id>.onnx.json` Piper voice placed in `TTS_PIPER_VOICE_DIR` (`/voices`) is added automatically at startup (a file named like a built-in voice overrides it). This is where a custom trained voice goes.

## API

- `GET /health` → `{"ok": true, "voices": ["thorsten", "juergen"], "default": "thorsten"}`
- `GET /voices` → `[{"id": "thorsten", "label": "Thorsten (Piper, German)", "engine": "piper"}, ...]`
- `POST /synthesize` with JSON `{"text": "...", "voice": "thorsten" | null}` → `audio/wav`, 16-bit PCM mono at the voice's native rate (Piper 22050 Hz, Pocket 24000 Hz).
  - `400` empty text (also after normalization), unknown voice, or invalid body
  - `413` text longer than `TTS_MAX_CHARS`
  - `500` synthesis failed
  - `503` `TTS_MAX_PENDING` uncached requests already waiting for synthesis (cache hits are still served)
  - `499` (no body) the client disconnected before its synthesis started, so it was skipped
  - Errors are JSON `{"detail": "..."}`. Response headers `X-TTS-Voice`, `X-TTS-Cache` (`hit`/`miss`), `X-TTS-Time-Ms`.

Text is normalized first (`normalize.py`): numbers to German words, coin amounts (`500k`, `500 k`, `1,5m`), dates (`06.11.2026` → "sechster November zweitausendsechsundzwanzig"), clock times (`5:30` → "fünf Uhr dreißig"), chat abbreviations (`gg`, `afk`, `brb`, `idk`, ...), stretched letters collapsed to 3, unspeakable characters removed. Digit runs over 20 digits are read as their first 6 digits plus "und so weiter". `TTS_MAX_CHARS` limits the input; since normalization makes text longer, the normalized text is cut again at a word boundary to `TTS_MAX_NORMALIZED_CHARS`, ending in "und so weiter" ("and so on" for English voices).

Synthesis runs one at a time in a threadpool; at most `TTS_MAX_PENDING` uncached requests wait for it, further ones get `503` right away, and requests whose client already disconnected are skipped. Results are kept in an LRU cache keyed by voice and normalized text, bounded by `TTS_CACHE_SIZE` entries and `TTS_CACHE_MAX_BYTES` total; a single WAV larger than a quarter of the byte budget is not cached.

## Configuration

| env                     | default             |
| ----------------------- | ------------------- |
| `TTS_VOICES`            | `thorsten,juergen,jenny,alan` + the eight `thorsten_*` voices |
| `TTS_DEFAULT_VOICE`     | `thorsten`          |
| `TTS_MAX_CHARS`         | `400` (input text)  |
| `TTS_MAX_NORMALIZED_CHARS` | `600` (text after normalization) |
| `TTS_MAX_PENDING`       | `8`                 |
| `TTS_THREADS`           | `3`                 |
| `TTS_CACHE_SIZE`        | `128` (entries)     |
| `TTS_CACHE_MAX_BYTES`   | `67108864` (64 MiB) |
| `TTS_PIPER_VOICE_DIR`   | `/voices`           |
| `TTS_PIPER_BUILTIN_DIR` | `/opt/piper`        |
| `TTS_POCKET_LANGUAGE`   | `german`            |
| `TTS_POCKET_PROMPT`     | `juergen`           |
| `HF_HOME`               | `/models/hf`        |

Pocket TTS downloads its weights from Hugging Face on first use into `HF_HOME`; mount a named volume there so it happens only once. The container runs as uid 10001, so bind mounts for `/models/hf` or `/voices` must be readable (and for `/models/hf` writable) by that uid.

Model pinning: the Piper voices are baked into the image from a fixed commit of `rhasspy/piper-voices` (`PIPER_VOICES_REV` in the `Dockerfile`), and every file is checked against its sha256 at build time. Pocket TTS has no revision setting of its own, but `pocket-tts==4.0.1` (pinned in `requirements.txt`) ships configs whose `hf://` weight, tokenizer and voice prompt paths all carry a fixed commit (`...@<sha>`), so its downloads are pinned by the package version. Known limitation: those runtime downloads are not checked against a sha256 by this service; they rely on the Hugging Face revision pin and on `huggingface_hub`.

Compose example:

```yaml
  tts:
    build:
      context: ./tts-service
    restart: unless-stopped
    volumes:
      - tts-models:/models/hf
      - ./tts-voices:/voices:ro

volumes:
  tts-models:
```

## Development

```sh
uv venv --python 3.12 /tmp/tts-venv
uv pip install --python /tmp/tts-venv/bin/python --index-strategy unsafe-best-match -r requirements-dev.txt
/tmp/tts-venv/bin/python -m pytest
TTS_PIPER_BUILTIN_DIR=/path/to/piper-models /tmp/tts-venv/bin/uvicorn main:app --port 5000
```
