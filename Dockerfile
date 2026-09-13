FROM node:22-slim

# Force clean rebuild - 4
RUN echo "Build $(date)" > /build.txt

# v3
RUN apt-get update -qq && apt-get install -y -qq ffmpeg fonts-dejavu-core 2>/dev/null && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=optional
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY .opencode/ ./.opencode/
COPY memory/ ./memory/
COPY assets/ ./assets/
COPY public/ ./public/
RUN mkdir -p storage/renders storage/news storage/assets storage/thumbnails storage/subtitles storage/audio storage/cache

EXPOSE 3001

# Read-only health probe: /api/jobs is the public metadata catalog (no auth),
# so this works in any environment without leaking job payloads.
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/jobs', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/api/server.js"]
