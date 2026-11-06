FROM node:22-alpine

WORKDIR /app

# ffmpeg converts the TTS service's WAV output for Discord voice.
RUN apk add --no-cache imagemagick imagemagick-webp imagemagick-jpeg imagemagick-heic ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
