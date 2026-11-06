"""TTS engines. Each engine turns normalized text into a 16-bit PCM mono WAV."""

from __future__ import annotations

import io
import logging
import threading
import wave
from pathlib import Path

log = logging.getLogger("tts.engines")


def pcm16_wav(samples: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(samples)
    return buf.getvalue()


class Engine:
    id: str
    label: str
    engine: str

    def synthesize(self, text: str) -> bytes:
        raise NotImplementedError

    def info(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "engine": self.engine}


class PiperEngine(Engine):
    """Piper ONNX voice, loaded eagerly."""

    engine = "piper"

    def __init__(self, voice_id: str, model_path: Path, label: str, threads: int):
        import onnxruntime
        from piper import PiperVoice

        self.id = voice_id
        self.label = label
        self.voice = PiperVoice.load(model_path)
        # PiperVoice.load uses default SessionOptions (one thread per core);
        # rebuild the session with a thread limit.
        opts = onnxruntime.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.voice.session = onnxruntime.InferenceSession(
            str(model_path), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        log.info("loaded piper voice %s from %s", voice_id, model_path)

    def synthesize(self, text: str) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            self.voice.synthesize_wav(text, wav)
        return buf.getvalue()


class PocketEngine(Engine):
    """Kyutai Pocket TTS, loaded lazily on first use."""

    engine = "pocket"

    def __init__(self, voice_id: str, label: str, language: str, prompt: str, threads: int):
        self.id = voice_id
        self.label = label
        self.language = language
        self.prompt = prompt
        self.threads = threads
        self._model = None
        self._state = None
        self._load_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            import torch
            from pocket_tts import TTSModel

            # pocket_tts calls torch.set_num_threads(1) on import.
            torch.set_num_threads(self.threads)
            log.info("loading pocket model (%s, prompt %s)", self.language, self.prompt)
            model = TTSModel.load_model(language=self.language)
            self._state = model.get_state_for_audio_prompt(self.prompt)
            self._model = model
            log.info("loaded pocket voice %s", self.id)

    def synthesize(self, text: str) -> bytes:
        import torch

        self.load()
        # No torch.inference_mode() here: pocket_tts decodes in a helper thread
        # and fails on inference tensors created outside that mode.
        audio = self._model.generate_audio(self._state, text)
        samples = (audio.detach().float().reshape(-1).clamp(-1.0, 1.0) * 32767.0).to(torch.int16)
        return pcm16_wav(samples.numpy().tobytes(), self._model.sample_rate)
