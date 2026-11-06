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

# Piper voices pinned to a fixed commit of rhasspy/piper-voices, each file checked by sha256
# (LFS oid for .onnx, sha256sum for .onnx.json). To update: take the new "sha" from
# https://huggingface.co/api/models/rhasspy/piper-voices and the new hashes from
# https://huggingface.co/api/models/rhasspy/piper-voices/tree/<sha>/<voice dir>.
ARG PIPER_VOICES_REV=e7229f7d33a10e145e109b886d661984201ac3c4
ADD --chmod=644 --checksum=sha256:9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1 \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx /opt/piper/
ADD --chmod=644 --checksum=sha256:6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json /opt/piper/
ADD --chmod=644 --checksum=sha256:c1764e652266cd6dcebf1b95c61973df5970a5f5272e94b655ff1ddf9a99d1ff \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium.onnx /opt/piper/
ADD --chmod=644 --checksum=sha256:92895b9e99f7cfc13f4a9879da615c3d6e0baa4d660e26d7b685abdd27a6d1d3 \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium.onnx.json /opt/piper/
ADD --chmod=644 --checksum=sha256:469c630d209e139dd392a66bf4abde4ab86390a0269c1e47b4e5d7ce81526b01 \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx /opt/piper/
ADD --chmod=644 --checksum=sha256:a9a7a93a317c9a3cb6563e37eb057df9ef09c06188a8a4341b0fcb58cba54dd4 \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json /opt/piper/
ADD --chmod=644 --checksum=sha256:0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330 \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_GB/alan/medium/en_GB-alan-medium.onnx /opt/piper/
ADD --chmod=644 --checksum=sha256:c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e \
    https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json /opt/piper/

RUN useradd --create-home --uid 10001 tts \
    && mkdir -p /models/hf /voices \
    && chown -R tts:tts /models /voices \
    && chmod 755 /opt/piper

COPY --chown=tts:tts *.py pronunciation.txt abbreviations.txt ./

USER tts

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
