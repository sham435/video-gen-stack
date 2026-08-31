# AI News Video Pipeline

Automated AI news video publishing system. Fetches headlines → plans a story → renders motion-graphics scenes on canvas → assembles with FFmpeg → publishes to YouTube — designed to run on free infrastructure (GitHub Actions cron).

```
NewsAPI → StoryDirector → ScenePlanner → TextIntentEngine → Canvas Render → FFmpeg → YouTube
                                        (manifest + conflict   (Timeline     (concat +
                                         resolver + layout)     Scheduler)    audio mix)
```

## Quick Start

```bash
git clone https://github.com/sham435/video-gen-stack.git
cd video-gen-stack
npm install
cp .env.example .env   # add your keys
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
| `ADMIN_API_KEY` | Shared admin key for API/dashboard auth (fails closed) |

### Trigger a Publish

Go to **Actions → Publish News Video → Run workflow** — or wait, it runs automatically every 30 minutes.

## Entry Points

| Entry | Command | Port |
|---|---|---|
| Broadcast engine (full pipeline) | `npm run broadcast` or `node scripts/composer.mjs` | — |
| Dashboard (newsroom + rendering) | `npm run dashboard` | `:3456` |
| HTTP API (jobs, news, renders) | `npm run dev` | `:3001` |
| Job queue worker | `npm run worker` | metrics `:9101` |
| API metrics | (started with API) | `:9100` |

All protected endpoints require `x-api-key: <ADMIN_API_KEY>` and fail closed (503) when the key is not configured. The dashboard loads `.env` via `node --env-file=.env`.

## Architecture

```
src/
├── index.mjs                 # NewsBroadcastEngine — orchestration + FFmpeg assembly
├── ai/
│   ├── StoryDirector.mjs     # Scene plan (hook/fact/explanation/...)
│   ├── ScenePlanner.mjs      # Narration + caption_focus per scene
│   └── CategoryDirector.mjs  # Per-category layout/overlay policy
├── pipeline/
│   ├── SceneTextManifest.mjs # Per-scene text layer manifest
│   ├── TextConflictResolver.mjs # 60% word-overlap de-dupe guard
│   ├── HeadlineEmphasisResolver.mjs
│   ├── RenderManifest.mjs    # Single-owner rendering gates (canvas vs ffmpeg)
│   └── VisualIntentEngine.mjs
├── layout/
│   ├── TextLayoutEngine.mjs  # Safe-zone-aware layout per role
│   ├── SafeZoneManager.mjs   # Role anchors + floors (headline 0.62, caption 0.78)
│   └── TextLayoutPreflight.mjs # Hard gate: violations fail the render
├── video/
│   ├── Compositor.mjs        # RenderDirector — z-order, timeline, ownership
│   ├── TextTimelineScheduler.mjs # Zero-overlap visibility windows per layer
│   ├── SceneEngine.mjs       # Per-frame canvas render
│   ├── CaptionEngine.mjs     # Word-synced karaoke captions
│   └── layers/               # Background, Hero, Glass, Information, Emphasis,
│                             # Caption, BroadcastUI, Branding, PostProcess
├── visuals/                  # BreakingBanner, HeadlineCard, DesignSystem, ...
├── style/text-tokens.mjs     # Single source of text sizes/weights
├── audio/                    # AudioMixer (-16 LUFS), VoiceSync, SoundFX
├── quality/                  # HookAnalyzer, CompositionJudge, RetentionSimulator,
│                             # QualityGuardian, QualityChecker
└── video-studio/             # CoverGenerator, ProductionJob, ScriptContract

apps/
├── api/                      # Express API: routes + provider services (local,
│                             # gemini, fal.ai, huggingface) + FFmpeg renderer
└── worker/jobs-worker.mjs    # SQLite job queue worker (video_generate, news_video)

packages/
├── auth/requireAuth.js       # x-api-key middleware (fails closed)
├── database/jobs.mjs         # SQLite job queue
├── logger.mjs                # pino structured logging (LOG_LEVEL)
├── metrics.mjs               # Prometheus metrics (nm_*)
└── dashboard/index.mjs       # Newsroom UI + contract rendering + scheduling

tests/                        # 38 tests: contract, layout, emphasis, metrics,
                              # jobs, db, auth, pipeline, render-manifest
```

## Text Rendering: Single-Owner Policy

Every semantic element has exactly **one owner** renderer. The canvas pipeline is the default authority:

| Element | Owner | Notes |
|---|---|---|
| Headline / hero / secondary | Canvas | `InformationLayer` (hook/fact/explanation) |
| Caption (karaoke) | Canvas | `CaptionEngine`, word-synced |
| Emphasis / AI accent | Canvas | `EmphasisLayer`, category accent color |
| Banner | Canvas | `BreakingBanner`, top of frame |
| Footer / brand bar | Canvas | `BrandingLayer` |
| Subtitle (SRT) | FFmpeg | **Off by default** — opt-in `burnSubtitles: true` |
| Footer image composite | FFmpeg | **Off by default** — opt-in `overlayFooter: true`, only when canvas footer is disabled |

`src/pipeline/RenderManifest.mjs` gates every renderer via `canRender(layer, owner)`; `Compositor` only draws layers the manifest grants it. This makes duplicate rendering (canvas karaoke + SRT burn of the same narration, canvas footer + `footer.png`) structurally impossible.

Text timing is managed by `TextTimelineScheduler`: exactly one focal layer per frame (banner → hero → secondary → AI accent), with fade envelopes; any schedule violating the zero-overlap policy throws `TEXT_TIMELINE_CONFLICT` and fails the render.

## Render Pipeline

```
1. FETCH        NewsAPI → top headlines
2. PLAN         StoryDirector → 5-7 scene plan (hook, fact, explanation, ...)
3. TEXT         SceneTextManifest → TextConflictResolver (60% de-dupe guard)
                → TextLayoutEngine (safe zones) → LayoutPreflight (hard gate)
4. TIMELINE     TextTimelineScheduler assigns non-overlapping windows
5. RENDER       Canvas 1920×1080 @ 10fps → PNG frames (Compositor + 9 layers)
6. ASSEMBLE     FFmpeg concat → 30fps yuv420p → voice + music mix (-16 LUFS)
7. QUALITY      QualityChecker scores the rendered video
8. PUBLISH      YouTube Standard (public, with source attribution)
```

## Video Output

| Feature | Detail |
|---|---|
| Resolution | 1920×1080 (16:9), 30fps output |
| Typography | Anton/Impact headlines (84px, max 2 lines @ 0.62H), Inter body |
| Footer | 34px bold brand + 44px URL, fixed bottom bar |
| Banner | Breaking bar full-width at top (48-64px), contained glow |
| AI accent | 72px category accent word, 200px from bottom |
| Captions | Word-synced karaoke, 3 words/line, safe-zone 0.78H |
| Music | Stereo, -16 LUFS normalized, 1.5s fade |
| Length | ~20-30 seconds per story |

## Operations

- **Observability**: pino JSON logs (`LOG_LEVEL`), Prometheus metrics on `:9100` (API) and `:9101` (worker) — jobs, durations, provider 429s, failure streaks (level-60 alert at ≥5 consecutive failures).
- **Rate limiting**: 10 req/min on `/api/generate` and `/api/news-video` (express-rate-limit).
- **Validation**: `npm test` (38 tests) and `node scripts/opencode-validate.mjs` (must exit 0 before commit).

## Self-Hosted API

| Endpoint | Description |
|---|---|
| `GET /api/health` | System status + version |
| `GET /api/news/headlines` | Fetch headlines |
| `GET /api/pipeline/status` | Pipeline + queue stats |
| `POST /api/generate` | Queue a video generation job |
| `POST /api/news-video` | Queue a news video job |
| `GET /api/cron-jobs` | Manage cron schedules |

## License

MIT
