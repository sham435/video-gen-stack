FROM node:22-slim

RUN apt-get update -qq && apt-get install -y -qq ffmpeg fonts-dejavu-core 2>/dev/null && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=optional
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY storage/ ./storage/
COPY config/ ./config/
COPY railway.json ./
EXPOSE 3001
CMD ["node", "apps/api/server.js"]
