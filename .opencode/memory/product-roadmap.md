# Product Roadmap

## Current Status (AI_ROADMAP.md)

- **Phase 1: Foundation** — Complete
- **Phase 2: Intelligence** — Complete  
- **Phase 3: Scale** — In Progress
- **Phase 4: Platform** — Planned
- **Phase 5: Intelligence Layer** — Planned
- **Phase 6: Autonomous Studio** — Planned
- **Phase 7: Singularity** — Vision

## Known Technical Debt

1. **AssetManager bug**: `resolve` method dropped scene properties for non-cached scenes (FIXED in 69ca579)
2. **ScenePlanner missing props**: `buildScene` didn't set `subheadline`/`text` (FIXED in 69ca579)
3. **Dual run() side-effect**: Entry-point check was wrong for ESM modules (FIXED in 69ca579)
4. **VoiceSync fallback**: ElevenLabs output not validated; espeak used `--stdout` (FIXED in 69ca579)
5. **NaN totalDuration**: Previous fix had logic gap (FIXED in 69ca579)
6. NaN duration from `timedScenes` (FIXED in 4c7cf4d)

## Next High-Impact Features

1. **Video Studio Session Manager** — Review/approve/edit videos before publishing
2. **Analytics Dashboard** — Track views, retention, engagement per video
3. **Content Calendar** — Schedule publications by category and time
4. **Multi-language TTS** — Support for non-English narration
5. **AB Test Templates** — Compare video styles for engagement
6. **Automatic Thumbnail Generation** — AI-generated thumbnails per scene
7. **Performance Budgets** — Enforce render time, file size, quality thresholds
8. **CI Test Suite** — Automated regression tests for pipeline stages

## Optimization Opportunities

1. **Render caching**: Cache frames between identical template runs
2. **Parallel rendering**: Process scenes in parallel instead of sequential
3. **FFmpeg hardware acceleration**: Use VideoToolbox (macOS) / NVENC (Linux)
4. **Database connection pooling**: Currently opens DB on each call
5. **Memory management**: Canvas frame buffer cleanup after concat
6. **Asset preloading**: Fetch Pexels/fal.ai assets during story planning stage
7. **Template hot-reload**: Watch template files for changes during dev

## Category Priorities

Based on current performance (from dashboard retention metrics):
1. **Technology** — Highest engagement, default category
2. **AI** — Growing fast, needs more coverage
3. **Science** — Strong retention, under-covered
4. **Cybersecurity** — Niche but loyal audience
5. **Space** — High shareability, seasonal interest