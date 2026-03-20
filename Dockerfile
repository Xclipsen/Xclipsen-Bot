FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache imagemagick

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
