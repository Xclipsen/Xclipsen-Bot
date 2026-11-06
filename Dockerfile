FROM node:22-alpine

WORKDIR /app

# ffmpeg converts the TTS service's WAV output and music/radio streams for Discord voice.
RUN apk add --no-cache imagemagick imagemagick-webp imagemagick-jpeg imagemagick-heic ffmpeg

# yt-dlp for /music play: the official standalone musl build (no Python needed), checked against
# the release checksums. Bump YTDLP_VERSION (or build with --build-arg YTDLP_VERSION=latest) to update it.
ARG YTDLP_VERSION=2026.10.26
RUN set -eux; \
  case "$(apk --print-arch)" in \
    x86_64) asset=yt-dlp_musllinux ;; \
    aarch64) asset=yt-dlp_musllinux_aarch64 ;; \
    *) echo "No yt-dlp build for $(apk --print-arch)"; exit 1 ;; \
  esac; \
  if [ "$YTDLP_VERSION" = latest ]; then base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
  else base="https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION"; fi; \
  cd /tmp; \
  wget -q "$base/$asset" "$base/SHA2-256SUMS"; \
  grep " $asset\$" SHA2-256SUMS | sha256sum -c -; \
  install -m 755 "$asset" /usr/local/bin/yt-dlp; \
  rm -f "$asset" SHA2-256SUMS

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Run as the image's unprivileged node user (uid 1000, like the owner of the host's data/ directory).
# The app files stay root-owned; only data/ and the home directory (yt-dlp's cache) are writable.
ENV HOME=/home/node XDG_CACHE_HOME=/home/node/.cache
RUN mkdir -p /app/data /home/node/.cache && chown node:node /app/data /home/node/.cache
USER node

CMD ["npm", "start"]
