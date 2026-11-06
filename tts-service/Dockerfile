FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/hf \
    TTS_PIPER_BUILTIN_DIR=/opt/piper \
    TTS_PIPER_VOICE_DIR=/voices \
    TTS_THREADS=3

WORKDIR /app

# piper-tts ships its own espeak-ng build and data, so no apt packages are needed.
COPY requirements.txt .
RUN pip install -r requirements.txt

ADD --chmod=644 https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx /opt/piper/
ADD --chmod=644 https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json /opt/piper/
ADD --chmod=644 https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium.onnx /opt/piper/
ADD --chmod=644 https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium.onnx.json /opt/piper/

RUN useradd --create-home --uid 10001 tts \
    && mkdir -p /models/hf /voices \
    && chown -R tts:tts /models /voices \
    && chmod 755 /opt/piper

COPY --chown=tts:tts *.py pronunciation.txt ./

USER tts

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
