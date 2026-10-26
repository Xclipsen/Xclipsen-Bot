FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache imagemagick imagemagick-webp imagemagick-jpeg imagemagick-heic

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
