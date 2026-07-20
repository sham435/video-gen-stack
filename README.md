# AI News Video Pipeline

Automated AI news video publishing system. Fetches headlines → generates themed scenes → renders with motion graphics → publishes to YouTube — all on a free GitHub Actions cron.

```
NewsAPI → OG Image / Pexels → Themed Scene → FFmpeg Render → YouTube
                  ↕                          ↕
            Storyboard Engine         Stereo Audio (-16 LUFS)
            Quality Scorer            52px Headlines
            Theme Detection           Ken Burns Zoom
```

## Quick Start

```bash
git clone https://github.com/sham435/video-gen-stack.git
cd video-gen-stack
npm install
```

### Set GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `NEWSAPI_KEY` | Your [NewsAPI](https://newsapi.org/register) key |
| `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth refresh token |
| `YOUTUBE_CLIENT_ID` | Google Cloud OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud OAuth secret |
| `PEXELS_API_KEY` | Free [Pexels](https://www.pexels.com/api/) key (for stock images) |

### Trigger a Publish

Go to **Actions → Publish News Video → Run workflow**

Or wait — it runs automatically every 30 minutes.

## Architecture

```
.github/workflows/
├── publish-news.yml      # Main: fetch → render → publish (every 30 min)
├── deploy.yml            # Deploy to Railway on push
└── auto-resume.yml       # Re-deploy when Railway recovers

.github/scripts/
├── generate-storyboard.mjs   # Fetches news + detects themes
├── quality-check.mjs          # Scores: visual, audio, text, brand
└── publish-news.mjs           # Renders video + uploads to YouTube

apps/api/
├── server.js                  # Express API
├── routes/                    # API endpoints
│   ├── video.js               # Cron + video generation
│   ├── news.js                # NewsAPI proxy
│   ├── publish.js             # TikTok/YouTube auth
│   └── pipeline.js            # Pipeline status
├── services/
│   ├── news.js                # NewsAPI client
│   ├── renderer.js            # FFmpeg scene composer
│   └── remotion.js            # Remotion renderer
└── publishers/
    └── youtube.js             # YouTube upload

packages/
├── branding/
│   ├── themes.js              # Color themes (Apple, Samsung, AI, Gaming...)
│   └── storyboard.js          # Scene JSON generator
├── media/
│   └── audio/manager.js       # Audio asset management
├── common/
│   ├── database/schema.js     # SQLite schema
│   ├── quality/scorer.js      # Quality scoring
│   ├── quality/validator.js   # Content validation
│   ├── rollback/manager.js    # Snapshot rollback
│   └── storage/manager.js     # Asset storage

scripts/
├── render.mjs                # Canvas-based 52px renderer
└── compose.mjs               # FFmpeg Ken Burns + music mix

assets/music/
└── lofi1.mp3                 # Copyright-free background music
```

## Render Pipeline

```
1. FETCH         NewsAPI → top 5 headlines
2. SELECT        Best article only (1 video = 1 story)
3. IMAGE         Pexels stock photo > OG image > blurred gradient
4. THEME         Apple=blue, Samsung=cyan, AI=purple, Gaming=pink
5. TEXT          52px headline + pill background + source
6. AUDIO         Stereo music @18% vol, -16 LUFS, fade in/out
7. PUBLISH       YouTube Short (public, with source attribution)
```

## Video Output

| Feature | Detail |
|---|---|
| Resolution | 1920×1080, 30fps |
| Text size | **52px** headlines, 22px source |
| Backgrounds | Gradient + blurred article image + image card |
| Music | Stereo, -16 LUFS normalized, 1.5s fade |
| Length | ~8-10 seconds |
| Theme colors | Auto-detected per brand (Apple, Samsung, AI, etc.) |

## Self-Hosted API

```bash
cp .env.example .env
# Add your keys
npm run dev
```

| Endpoint | Description |
|---|---|
| `GET /api/health` | System status + version |
| `GET /api/news/headlines` | Fetch headlines |
| `GET /api/pipeline/status` | Pipeline + queue stats |
| `POST /api/cron/news-video` | Trigger a news video |
| `GET /api/cron-jobs` | Manage cron schedules |

## License

MIT
