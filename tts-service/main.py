"""Self-hosted German TTS HTTP service for the Xclipsen Discord bot."""

from __future__ import annotations

import os

THREADS = max(1, int(os.environ.get("TTS_THREADS", "3")))
# Must be set before torch / onnxruntime are imported.
for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(_var, str(THREADS))

import logging
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from engines import Engine, PiperEngine, PocketEngine
from normalize import normalize

logging.basicConfig(
    level=os.environ.get("TTS_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("tts")

MAX_CHARS = int(os.environ.get("TTS_MAX_CHARS", "400"))
CACHE_SIZE = int(os.environ.get("TTS_CACHE_SIZE", "128"))
VOICE_IDS = [v.strip() for v in os.environ.get("TTS_VOICES", "thorsten,juergen").split(",") if v.strip()]
DEFAULT_VOICE = os.environ.get("TTS_DEFAULT_VOICE", "thorsten").strip()
PIPER_VOICE_DIR = Path(os.environ.get("TTS_PIPER_VOICE_DIR", "/voices"))
PIPER_BUILTIN_DIR = Path(os.environ.get("TTS_PIPER_BUILTIN_DIR", "/opt/piper"))
POCKET_LANGUAGE = os.environ.get("TTS_POCKET_LANGUAGE", "german")
POCKET_PROMPT = os.environ.get("TTS_POCKET_PROMPT", "juergen")

BUILTIN_PIPER = {
    "thorsten": ("de_DE-thorsten-high.onnx", "Thorsten (Piper, German)"),
}
POCKET_VOICES = {
    "juergen": "Jürgen (Pocket TTS, German)",
}


def _piper_dir_voices() -> dict[str, Path]:
    if not PIPER_VOICE_DIR.is_dir():
        return {}
    found = {}
    for model in sorted(PIPER_VOICE_DIR.glob("*.onnx")):
        if model.with_name(model.name + ".json").is_file():
            found[model.stem] = model
        else:
            log.warning("ignoring %s: missing %s.json", model, model.name)
    return found


def build_voices() -> tuple[dict[str, Engine], str]:
    """Voices listed in TTS_VOICES, plus every Piper voice in TTS_PIPER_VOICE_DIR.

    A <id>.onnx in the voice dir overrides a built-in Piper voice of the same id.
    """
    dir_voices = _piper_dir_voices()
    ids = VOICE_IDS + [v for v in dir_voices if v not in VOICE_IDS]
    voices: dict[str, Engine] = {}
    for voice_id in ids:
        if voice_id in dir_voices:
            voices[voice_id] = PiperEngine(
                voice_id, dir_voices[voice_id], f"{voice_id.capitalize()} (Piper, custom)", THREADS
            )
        elif voice_id in BUILTIN_PIPER:
            filename, label = BUILTIN_PIPER[voice_id]
            path = PIPER_BUILTIN_DIR / filename
            if not path.is_file():
                log.error("voice %s: model %s not found, skipping", voice_id, path)
                continue
            voices[voice_id] = PiperEngine(voice_id, path, label, THREADS)
        elif voice_id in POCKET_VOICES:
            voices[voice_id] = PocketEngine(
                voice_id, POCKET_VOICES[voice_id], POCKET_LANGUAGE, POCKET_PROMPT, THREADS
            )
        else:
            log.error("unknown voice %r in TTS_VOICES, skipping", voice_id)
    if not voices:
        raise RuntimeError("no TTS voices available")
    default = DEFAULT_VOICE
    if default not in voices:
        default = next(iter(voices))
        log.warning("default voice %r not available, using %r", DEFAULT_VOICE, default)
    return voices, default


class LRUCache:
    def __init__(self, size: int):
        self.size = size
        self._data: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple[str, str]) -> bytes | None:
        with self._lock:
            value = self._data.get(key)
            if value is not None:
                self._data.move_to_end(key)
            return value

    def put(self, key: tuple[str, str], value: bytes) -> None:
        if self.size <= 0:
            return
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)


state: dict = {}
synth_lock = threading.Lock()
cache = LRUCache(CACHE_SIZE)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    voices, default = build_voices()
    state["voices"] = voices
    state["default"] = default
    log.info("voices: %s (default %s), threads %d", ", ".join(voices), default, THREADS)
    yield


app = FastAPI(title="Xclipsen TTS", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"detail": "invalid request body", "errors": exc.errors()})


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "voices": list(state["voices"]), "default": state["default"]}


@app.get("/voices")
def voices():
    return [engine.info() for engine in state["voices"].values()]


def _synthesize(engine: Engine, text: str) -> tuple[bytes, bool]:
    key = (engine.id, text)
    cached = cache.get(key)
    if cached is not None:
        return cached, True
    if isinstance(engine, PocketEngine):
        # Load outside the synthesis lock so other voices keep working meanwhile.
        engine.load()
    with synth_lock:
        cached = cache.get(key)
        if cached is not None:
            return cached, True
        audio = engine.synthesize(text)
    cache.put(key, audio)
    return audio, False


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    if len(req.text) > MAX_CHARS:
        raise HTTPException(413, f"text longer than {MAX_CHARS} characters")
    voice_id = req.voice or state["default"]
    engine = state["voices"].get(voice_id)
    if engine is None:
        raise HTTPException(400, f"unknown voice {voice_id!r}")
    text = normalize(req.text)
    if not text:
        raise HTTPException(400, "text is empty")

    started = time.perf_counter()
    try:
        audio, hit = await run_in_threadpool(_synthesize, engine, text)
    except Exception:
        log.exception("synthesis failed (voice %s)", voice_id)
        raise HTTPException(500, "synthesis failed")
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    log.info("voice=%s chars=%d cache=%s %dms", voice_id, len(text), "hit" if hit else "miss", elapsed_ms)
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "X-TTS-Voice": voice_id,
            "X-TTS-Cache": "hit" if hit else "miss",
            "X-TTS-Time-Ms": str(elapsed_ms),
        },
    )
