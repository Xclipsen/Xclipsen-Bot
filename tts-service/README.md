# tts-service

Small self-hosted German text-to-speech HTTP service for the Xclipsen bot. Runs CPU-only as a second container in the compose project and is reachable internally as `http://tts:5000`.

Voices:

| id         | engine                           | notes                                  |
| ---------- | -------------------------------- | -------------------------------------- |
| `thorsten` | Piper `de_DE-thorsten-high`      | default, loaded at startup, ~300 MB    |
| `juergen`  | Kyutai Pocket TTS (`german`)     | loaded on first use, ~1 GB more RAM    |
| `thorsten_whisper`, `_sleepy`, `_drunk`, `_angry`, `_amused`, `_surprised`, `_disgusted`, `_neutral` | Piper `de_DE-thorsten_emotional-medium` speakers | one shared model, ~80 MB for all eight |

Any `<id>.onnx` + `<id>.onnx.json` Piper voice placed in `TTS_PIPER_VOICE_DIR` (`/voices`) is added automatically at startup (a file named like a built-in voice overrides it). This is where a custom trained voice goes.

## API

- `GET /health` → `{"ok": true, "voices": ["thorsten", "juergen"], "default": "thorsten"}`
- `GET /voices` → `[{"id": "thorsten", "label": "Thorsten (Piper, German)", "engine": "piper"}, ...]`
- `POST /synthesize` with JSON `{"text": "...", "voice": "thorsten" | null}` → `audio/wav`, 16-bit PCM mono at the voice's native rate (Piper 22050 Hz, Pocket 24000 Hz).
  - `400` empty text (also after normalization), unknown voice, or invalid body
  - `413` text longer than `TTS_MAX_CHARS`
  - `500` synthesis failed
  - Errors are JSON `{"detail": "..."}`. Response headers `X-TTS-Voice`, `X-TTS-Cache` (`hit`/`miss`), `X-TTS-Time-Ms`.

Text is normalized first (`normalize.py`): numbers to German words, chat abbreviations (`gg`, `afk`, `brb`, `idk`, ...), stretched letters collapsed to 3, unspeakable characters removed. Synthesis runs one at a time in a threadpool; results are kept in an LRU cache keyed by voice and normalized text.

## Configuration

| env                     | default             |
| ----------------------- | ------------------- |
| `TTS_VOICES`            | `thorsten,juergen` + the eight `thorsten_*` voices |
| `TTS_DEFAULT_VOICE`     | `thorsten`          |
| `TTS_MAX_CHARS`         | `400`               |
| `TTS_THREADS`           | `3`                 |
| `TTS_CACHE_SIZE`        | `128`               |
| `TTS_PIPER_VOICE_DIR`   | `/voices`           |
| `TTS_PIPER_BUILTIN_DIR` | `/opt/piper`        |
| `TTS_POCKET_LANGUAGE`   | `german`            |
| `TTS_POCKET_PROMPT`     | `juergen`           |
| `HF_HOME`               | `/models/hf`        |

Pocket TTS downloads its weights from Hugging Face on first use into `HF_HOME`; mount a named volume there so it happens only once. The container runs as uid 10001, so bind mounts for `/models/hf` or `/voices` must be readable (and for `/models/hf` writable) by that uid.

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
