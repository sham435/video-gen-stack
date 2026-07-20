FROM node:22-slim

# v3
RUN apt-get update -qq && apt-get install -y -qq ffmpeg fonts-dejavu-core 2>/dev/null && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=optional
COPY apps/ ./apps/
COPY packages/ ./packages/
RUN mkdir -p storage/renders storage/news storage/assets storage/thumbnails storage/subtitles storage/audio storage/cache

EXPOSE 3001
CMD ["node", "apps/api/server.js"]
