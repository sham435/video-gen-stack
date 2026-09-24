# NEWS-MONSTER Stack Index & Milestones

> Living reference: milestones we shipped, every module we own, how to insert a
> new news module, and where to look when something breaks.
> Keep this file updated on every milestone — it is the stack's single index.

## Registration-First Architecture — do NOT skip

This repository follows the **REGISTER FIRST → CONTRACT → IMPLEMENT → TEST → VERIFY → MIRROR → INDEX → COMMIT** doctrine. Registry suite:

| Doc | Purpose |
|---|---|
| `docs/ARCHITECTURE_REGISTRY.md` | change log, content types, allocation 48/24/12/12, providers, env vars, constants, errors, mirror registry |
| `docs/MODULE_REGISTRY.md` + `docs/registry/module-registry.json` | every production module (schema + publicApis), machine-validated |
| `docs/API_REGISTRY.md` | every REST route + auth/rate contract |
| `docs/DATA_CONTRACTS.md` | article contract, SEO contract, allocation, ledger, events |
| `docs/DEBUGGING_INDEX.md` | deterministic symptom → module → method → state |
| `docs/BRAND_GUIDE.md` | permanent NEWS-MONSTER brand/SEO context (`#newsmonster`, `@news-monster`, channel URL/ID) |

Gate: **`npm run architecture:validate`** must stay clean before a pipeline commit
(module/tests/mirror consistency, exported APIs, env vars).

Root: `/Users/sham4/vedio_genspark` · Branch: `main` · Stack: Node ESM (`"type": "module"`) · Canvas: `@napi-rs/canvas` · Render: FFmpeg
Test suite: `npm test` (`node --test tests/*.test.mjs`) — **must stay green before any pipeline commit**.
Two deploy targets: GitHub Actions (canonical `src/`) + Railway 30-min cron (`deploy-staging/`).

---

## 1. Achieved Milestones

| Date | Milestone | Evidence |
|---|---|---|
| 2026-09 | **Registration-first architecture docs + `architecture:validate` v1** — 5 registry docs, 87-module machine registry, validator (module/tests/mirror/env/API checks) | `docs/*.md`, `docs/registry/module-registry.json`, `scripts/architecture-validate.mjs` |
| 2026-09 | **Canonical brand identity registered (BRAND-001)** — `#newsmonster` cross-platform tag, `@news-monster` handle (NOT `@newsmonster`), channel URL/ID locked; `docs/BRAND_GUIDE.md` permanent AI context + validator baseline FAIL rule + brand invariants in tests | `docs/BRAND_GUIDE.md`, `docs/ARCHITECTURE_REGISTRY.md` CHANGE-002 |
| 2026-09 | **Production evidence — central LinkedIn SEO projection (BRAND-001)** — real published UGC post URN `urn:li:ugcPost:7508583498220244992` (post URL `https://www.linkedin.com/feed/update/urn:li:ugcPost:7508583498220244992/`); contract chain `seoMetadata → buildSeoMetadata → SocialPostGenerator → LinkedInPostFactory`; observed exactly 5 hashtags, baseline order `#technology #breaking #newsmonster`, `#newsmonster` invariant present, 2 story-specific mined hashtags (`#tech`, `#innovation` — evidence for this story, NOT the contract; contract = remaining slots are story-specific mined tags), `#` prefix applied only at presentation boundary; cap `MAX_LINKEDIN_HASHTAGS`; status **production-verified** | BRAND-001 / Commit C |
| 2026-09 | **LinkedIn native video (embedded player) fixed** — GH Actions now authenticates with client creds, posts via UGC API; verified run 35784582948 → ugcPosts `7508272041268043776` / `7508272719264899073` | commit `7e44233` |
| 2026-09 | **Central SEO metadata builder** (`seoMetadata.mjs`) — one sink for title/description/hashtags/youtubeTags/linkedinHashtags; baseline `#Technology #Breaking #NewsMonster` + 2–5 story tags, dedup + platform projection (LinkedIn 3–5, YouTube ≤15) | `src/publishing/seoMetadata.mjs` |
| 2026-09 | **quote-format split** (QuoteVideoEngine/QuoteRenderer/QuoteLineAgent per format) | PR #201 |
| 2026-09 | **narration dedup gate** (script uniqueness before render) | PR #202 |
| 2026-09 | **gitignore chore** (artifacts, debug scripts out of git) | PR #203 |
| 2026-09 | **suite ~1372 tests green** | `npm test` |
| 2026-09 | **YouTube OAuth redirect_uri unified** for Railway vs localhost | commit `8967744` |
| 2026-09 | **Retention intro/replay loop tightened** | commit `4e62032` |
| 2026-09 | **Story-hook thumbnail refinement (high-CTR)** | commit `c6a23f9`, PR #270 |
| 2026-08 | **Asset uniqueness + quarantine** (dedup images/script/music before use) | `src/uniqueness/*` |
| 2026-08 | **`ASSET_REGISTRY_PATH` env override + temp-ledger test isolation** | `src/uniqueness/AssetRegistry.mjs` |
| 2026-08 | **C2PA content signing** (provenance for produced videos) | `src/pipeline/ContentCredentials.mjs` |

---

## 2. Production Pipeline (stage flow)

```
news fetch (RapidNewsProvider/NewsDataProvider)
  → article (ProductionJob)
  → niche detect (youtube/nicheResolver) + story algorithm (StoryAlgorithmRegistry)
  → script/narration + uniqueness gate (ScriptUniqueness)
  → scene plan (ScenePlanner → SceneEngine.buildScenesForAlgorithm)
  → visual selection (SemanticVisualRankerV2, VisualSearchEngine) + asset registry
  → canvas render (SceneEngine/Compositor + layers) → FFmpeg concat + audio mix
  → thumbnail (ThumbnailCandidateGenerator → judge → upload)
  → C2PA sign → publishability gate
  → PUBLISH: composer.mjs → YouTube upload (YouTubeSEO tags) + LinkedIn native video (LinkedInPostFactory)
  → PROMOTE (optional): SocialDistributionManager (LinkedIn image post + YouTube community)
  → verify (YouTubePropagationVerifier, PostPublishVerifier) → ledger (PublicationLedger)
```

Entry point scripts: `scripts/composer.mjs` (publish pipeline), `src/index.mjs` (NewsBroadcastEngine, broadcast), `apps/worker/jobs-worker.mjs` (queued jobs).

---

## 3. Module Index (layer → file → role → key API)

### 3.1 AI / Story layer (`src/ai/`)
| File | Role | Key API |
|---|---|---|
| `StoryAlgorithmRegistry.mjs` | pick narrative algorithm (arc/structure/tone) | `pickAlgorithm(article)`, consts `ARCS/HOOKS/STRUCTURES` |
| `StoryDirector.mjs` | generic vs specific template routing | `StoryDirector`, `isGenericStoryTemplate` |
| `ScenePlanner.mjs` | clamp scene count/durations | `ScenePlanner` |
| `CategoryDirector.mjs` | per-category direction | `getDirector(category)`, `CATEGORY_DIRECTORS` |
| `providers/*.mjs` | AI provider chain (Zen/OpenRouter/Gemini/Ollama/OpenAI) | `resolveProviderChain(env)`, `withRetry`, `buildProviders` |
| `PromptEngine.mjs` | prompt construction | `PromptEngine` |
| `SelfHealingExecutor.mjs` | retry/self-heal on provider failure | `SelfHealingExecutor` |
| `TopicOpportunityEngine.mjs` | viral potential scoring (REJECT 0.55 / REGEN 0.70 / PRIORITY 0.82) | `scoreViralPotential`, `TopicOpportunityEngine` |

### 3.2 Orchestration (`src/orchestrator/`)
| File | Role | Key API |
|---|---|---|
| `ProductionJob.mjs` | one production unit | `ProductionJob` |
| `ProductionScheduler.mjs` | queue + events | `ProductionScheduler extends EventEmitter` |
| `Stages.mjs` | stage graph + FailureClass | `STAGES`, `classifyError`, `nextStage` |
| `StageTraceRecorder.mjs` | per-run trace | `StageTraceRecorder`, `TraceStatus` |
| `PublishabilityGate.mjs` | gate before publish | `PublishabilityGate`, `ProductionError` |
| `RetryPolicy.mjs` | delay/retry decision | `nextDelay`, `shouldRetry` |
| `ArtifactID.mjs` | deterministic artifact ids | `articleId`, `videoArtifactId`, `buildJobId` |

### 3.3 Video (`src/video/`)
| File | Role | Key API |
|---|---|---|
| `SceneEngine.mjs` | frame pipeline + scene building | `SceneEngine`, `buildScenesForAlgorithm(article, algorithm)` |
| `MotionEngine.mjs` | 10 camera/motion effects | `applyMotionEffect(ctx, effectName, progress, ...)` |
| `Compositor.mjs` | composite layers per frame | `Compositor` |
| `Timeline.mjs` + `TextTimelineScheduler.mjs` | frame scheduling + priority | `Timeline`, `PRIORITY` |
| `CaptionEngine.mjs` | word-synced captions | `buildWordTimings(script, duration)`, `renderCaptions` |
| `NarrativeTextComposition.mjs` | headline/caption/outro state machine | `resolveNarrativeAt(time, scene, duration)` |
| `RenderProfile.mjs` | resolution profiles (VIDEO_HD) | `VIDEO_HD`, `DEFAULT_PROFILE`, `sx/sy/sf` |
| `validateOutput.mjs` | post-render validation | `validateRenderOutput(videoPath)` |
| `layers/*.mjs`, `effects/ProductionEffectEngine.mjs`, `footer/*.mjs` | visual layers/effects/footer | per-layer classes |

### 3.4 Audio (`src/audio/`)
| File | Role | Key API |
|---|---|---|
| `AudioMixer.mjs` | voice 70 / music 20 / sfx 10, −14 LUFS | `AudioMixer` |
| `AudioDirector.mjs` | per-scene audio orchestration | `AudioDirector`, `normalizeOne`, `computeLoopsNeeded` |
| `MusicFamily.mjs` | pick music family/track | `pickMusicTrack`, `resolveMusicFamily`, `trackIndexFor` |
| `MoodAnalyzer.mjs` | scene→mood | `analyzeMood` |
| `VoiceSync.mjs` / `SoundFX.mjs` | TTS alignment / sfx | classes |

### 3.5 Publishing (focus area — see §4)
`src/publishing/`: `seoMetadata.mjs`, `HashtagBuilder.mjs`, `YouTubeSEO.mjs`, `LinkedInPostFactory.mjs`, `LinkedInPublisher.mjs`, `SocialPostGenerator.mjs`, `SocialDistributionManager.mjs`, `SocialDistributionStore.mjs`, `YouTubeCommunityPublisher.mjs`, `PinnedCommentBuilder.mjs`, `PublicationLedger.mjs`, `PostPublishVerifier.mjs`, `YouTubePropagationVerifier.mjs`, `PublishingEnhancer.mjs`, `TitleTemplates.mjs`, `TopicCtaBuilder.mjs`, `BrandOutro.mjs`, `retry.mjs`.

### 3.6 Distribution (`src/distribution/`)
`DistributionOrchestrator`, `LinkedInDistributor` (uses `postFactory.create(artifact.metadata)`), `YouTubeDistributor`, `GitHubPagesDistributor`, `GitSiteDeployer`, `PublicationArtifact`, `DistributionState`.

### 3.7 Quality (`src/quality/`) · Thumbnail (`src/thumbnail/`, `src/thumbnails/`) · Analytics (`src/analytics/`)
Quality: `QualityChecker`, `QualityGuardian`, `CompositionJudge`, `FrameVisionAnalyzer`, `RetentionSimulator/Predictor`, `ViewerBehaviorModel`, `HookAnalyzer`.
Thumbnail: `ThumbnailCandidateGenerator`, `ThumbnailJudge`, `ThumbnailFactory`, `ThumbnailUploader/Verifier`, `ThumbnailMediaValidator`, `ThumbnailLifecycleManager` (refresh policy), `CoverGenerator/Director` (`src/video-studio/`).
Analytics: `AnalyticsCollector`, `EngagementScore`, `RetentionPatternLearner`, `ImagePerformanceMemory`, `ThumbnailIntelligence`.

### 3.8 Assets / Uniqueness (`src/assets/`, `src/uniqueness/`)
`VisualSearchEngine` (search stock), `ImageRanker`, `DuplicateDetector` (`rejectDuplicates`), `ImageDatabase` (SQLite), `AssetRegistry` (`ASSET_REGISTRY_PATH` override, quarantine), `ScriptUniqueness` (narration dedup gate), `GlobalAssetUniquenessGate`, `MusicUniqueness`.

### 3.9 News ingestion (`src/news/`) · Auth/YouTube (`src/youtube/`)
`NewsDataProvider` (`fetchTopHeadlines({category, size})`), `RapidNewsProvider`, `RapidNewsBudget` (rate gate).
`nicheResolver.mjs` (`detectNiche`, `NICHES`, `applyConfidencePolicy`), `nicheProfiles.mjs` (`getProfile(niche)`), `youtubeStudioLink.mjs` (OAuth: `SCOPES`, `getAuthUrl`, `exchangeCode`, `getAccessToken`), `thumbnailValidator.mjs`.

---

## 4. Publishing / SEO plank (current active work)

### 4.1 Single sink: `src/publishing/seoMetadata.mjs`
```js
buildSeoMetadata(article, generatedContent = null)
  → { title, description, hashtags, youtubeTags, linkedinHashtags, keywords }
// hashtags:        bare lowercase, baseline-first, deduped, ≤15 (YT_MAX_TAGS)
// youtubeTags:     bare `hashtags.slice(0, 15)`          → YouTube snippet.tags
// linkedinHashtags:'#tag' prefixed `hashtags.slice(0, 5)` → LinkedIn post
```
Constants: `BASELINE_HASHTAGS = ['technology','breaking','newsmonster']` (algorithm is
`dedupeTags([...BASELINE, ...mineStoryTags(...)])` — baseline first ⇒ slice is always ≥3),
`IT_MAX_TAGS = 15`, `YT_MAX_TAG_CHARS = 100`, `MAX_LINKEDIN_HASHTAGS = 5`, `NICHE_TO_ENTITIES`, `BLOCKLISTED`, `STOP_WORDS`.
Exports: `normalizeTag`, `dedupeTags`, `mineStoryTags`, `buildSeoMetadata`, `SEO_BUILDERS`.

### 4.2 Producers & consumers (who may call `buildSeoMetadata`)
| Module | Role | Authoritative? |
|---|---|---|
| `SocialPostGenerator.build(video)` | builds promo posts; **must be THE producer**: `seo = buildSeoMetadata({...})` then attach `{hashtags, youtubeTags, linkedinHashtags}` | ✅ yes (main path) |
| `scripts/composer.mjs` UPLOAD stage | build seo once; pass `seo.youtubeTags` → `buildYouTubeSEO`, `seo.linkedinHashtags` → UGC video | ✅ yes (main path) |
| `LinkedInPostFactory` | consumes `video.linkedinHashtags` — **never re-slices** (`legacyHashtagProjection` = isolated compat only) | consumes |
| `YouTubeSEO.buildYouTubeSEO(args)` | `tags = args.seo?.youtubeTags || deriveYouTubeTags(args)` (derive kept for standalone/tests only) | consumes |
| `HashtagBuilder` | legacy builder — backwards compat only, do NOT add new callers | deprecated |

**Inserting a new platform (e.g. TikTok/X):** add a projection in `buildSeoMetadata`, export it,
consume it in the new publisher, add a deepEqual test against `seo.<projection>`.

### 4.3 Data contract every publisher must honor
- LinkedIn: `hashtags` array of `#tag` strings, length 3–5, baseline tags always present.
- YouTube: `tags` bare lowercase, ≤15 items, ≤100 chars combined; `categoryId` from `YOUTUBE_CATEGORY_IDS`.
- Promo posts: comment text must include the display hashtags (`#`-prefixed).

---

## 5. How to Insert a New News Module

1. **Ingest**: add/extend a provider in `src/news/` returning the article shape
   `{title, description, url, source, category, publishedAt, tags?, keywords?}`.
2. **Classify**: ensure the category resolves via `resolveNiche` / `NICHE_TO_ENTITIES` / `CATEGORY_PROFILES` (add new keys there, not in code branches).
3. **SEO**: `buildSeoMetadata` mines story tags from headline/description/keywords + `NICHE_TO_ENTITIES` — add entity keywords for the new niche, no other wiring needed.
4. **Publish**: add an `XxxPublisher` under `src/publishing/` consuming the seo projections (see §4.2); register in `scripts/composer.mjs` PUBLISH stage; add `tests/xxx.test.mjs`.
5. **Mirror**: `cp` the source to `deploy-staging/src/...` and `diff -q` (byte-sync convention, see §7).
6. **Gate**: keep `node --test tests/*.test.mjs` green (currently ~1372 assertions).

---

## 6. Debugging Index (failure → where to look)

| Symptom | Look in |
|---|---|
| Run failed at some stage | `data/` traces → `StageTraceRecorder` → `src/orchestrator/Stages.mjs` (`FailureClass`) |
| Video render artifacts/black frames | `src/video/SceneEngine.mjs`, `validateOutput.mjs`, `tests/render-validation.test.mjs` |
| Caption/narration mismatch | `src/video/CaptionEngine.mjs`, `VoiceSync.mjs`, `ScriptUniqueness` |
| Audio too quiet/loud or clipped | `src/audio/AudioMixer.mjs` (70/20/10, −14 LUFS), `loop-duration` tests |
| Duplicate visuals/music reused | `src/assets/DuplicateDetector.mjs`, `src/uniqueness/AssetRegistry.mjs` |
| Thumbnail rejected by YouTube | `src/thumbnail/ThumbnailMediaValidator.mjs` (2MB), `Uploader`, `Verifier`, `ThumbnailLifecycleManager.REFRESH_POLICY` |
| YouTube upload/auth fails | `src/youtube/youtubeStudioLink.mjs`, `YouTubeQuotaAuditor`, `retry.mjs`; `token` command |
| LinkedIn post not native video | `src/publishing/LinkedInPostFactory.mjs` (UGC API, must pass `linkedinHashtags`), `LinkedInPublisher`; workflow must inject `LINKEDIN_CLIENT_ID/SECRET` |
| Hashtags wrong/missing on a platform | `src/publishing/seoMetadata.mjs` FIRST, then the publisher — verify it consumes the seo projection, not `HashtagBuilder`/`.slice()` |
| Provider AI flaky | `src/ai/providers/`: `ProviderChain`, `withRetry`, `modelHealth`, `LiveModelCatalog` |
| Content not unique | `src/uniqueness/*` gates + `data/` registry (quarantine 7 days) |
| C2PA/provenance errors | `src/pipeline/ContentCredentials.mjs`, `CertificateManager` |
| Landing page stale | `data/` + `GitHubPagesDistributor` / `GitSiteDeployer`; refresh commits are `chore: refresh landing page video feed` |
| Railway vs Actions divergence | **Likely mirror drift** — see §7, run the sync script |

---

## 7. Mirror-Sync Convention (Railway `deploy-staging/`)

`deploy-staging/` is a **manual byte-sync mirror**, NOT generated (no generator/rsync/Makefile).
Files under `src/publishing/`, `scripts/` etc. exist twice and **must stay byte-identical**:

```bash
cp src/publishing/<file>.mjs deploy-staging/src/publishing/<file>.mjs
diff -q src/publishing/<file>.mjs deploy-staging/src/publishing/<file>.mjs   # => identical
```

Checked-on-touch: `HashtagBuilder`, `SocialPostGenerator`, `YouTubeSEO`, `LinkedInPostFactory`,
`seoMetadata`, `scripts/composer.mjs`. If any diverge, fix the mirror before committing.
`deploy-staging/` infra (`Dockerfile`, `railway.json`, `.railwayignore`) is untracked, not committed.