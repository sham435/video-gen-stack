# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   NEWS-MONSTER                       │
├─────────────────────────────────────────────────────┤
│  Apps                                               │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ API      │  │Dashboard │  │ Worker Pipeline   │ │
│  │ :3001    │  │ :3456    │  │ (NewsPipeline)    │ │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘ │
├───────┴──────────────┴─────────────────┴────────────┤
│  Core Engine (src/)                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ AI       │  │ Video    │  │ Audio             │ │
│  │ Engine   │  │ Studio   │  │ Engine            │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Quality  │  │ Visuals  │  │ Broadcast         │ │
│  │ Suite    │  │ Engine   │  │ Engine            │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
├─────────────────────────────────────────────────────┤
│  Packages                                            │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Database │  │ Branding │  │ Editorial Pipeline │ │
│  │ (SQLite) │  │ System   │  │ Orchestrator      │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Storage  │  │ Quality  │  │ Media/Audio       │ │
│  │ Manager  │  │ Tools    │  │ Manager           │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
├─────────────────────────────────────────────────────┤
│  OpenCode Engine (.opencode/)                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Agents   │  │ Memory   │  │ Workflows         │ │
│  │ (7)      │  │ (6)      │  │ (4)               │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────┐                         │
│  │ Policies │  │ Bridge   │                         │
│  │ (4)      │  │ Module   │                         │
│  └──────────┘  └──────────┘                         │
└─────────────────────────────────────────────────────┘
```

## Video Pipeline (the core revenue-generating path)

```
Article → StoryPlan → ScenePlan → VisualPlan → 
  AssetFetch → FrameRender(Canvas) → FFmpegConcat → 
  AudioMix(TTS+Music+SFX) → FooterOverlay → QualityCheck → 
  Publish(YouTube/TikTok)
```

## Data Flow

1. **News Ingestion**: NewsAPI → 13-category classifier → dedup via `DuplicateDetector`
2. **Story Planning**: OpenRouter LLM → JSON story plan → scene blueprint
3. **Asset Resolution**: Visual prompt → Pexels/fal.ai → local cache
4. **Frame Rendering**: Canvas 1080x1920 @ 10fps → 300 PNG frames
5. **Video Assembly**: FFmpeg concat → H.264+AAC @ 30fps
6. **Audio Mix**: TTS voice + background music + sound effects → -14 LUFS
7. **Quality Check**: ffprobe analysis + AI quality scoring + retention prediction
8. **Publishing**: YouTube Data API v3 (OAuth2) + TikTok API

## Database Architecture

Two SQLite databases:
- `data/newsroom.db` — 9 tables (users, articles, projects, templates, renders, publish jobs, assets, audit, snapshots)
- `data/newsroom.db` — 20 tables (V3: news articles, projects, templates, render/publish jobs; legacy unified: published articles, renders, assets, analytics, branding config, pipeline logs, cron jobs, snapshots, fonts, templates, audio)

Plus runtime schemas for: audio_assets, audio_mix_presets, font_profiles, templates, snapshots, cron_jobs (~6 more tables)

## Key Design Decisions

1. **ESM only**: All source is `"type": "module"` with `.mjs` extension
2. **Canvas over WebGL**: `@napi-rs/canvas` for server-side frame rendering (no browser needed)
3. **FFmpeg subprocess**: All video/audio processing via `execSync`/`execFileSync`
4. **LLM-first planning**: Story structure, scene mapping, and visual prompts all AI-generated
5. **Category-based theming**: Each news category has unique visual style, color palette, and template
6. **Fallback chains**: Every external dependency has a degradation path (e.g., ElevenLabs → edge-tts → espeak)