# MODULE_REGISTRY.md

> Machine-readable source of truth: **`docs/registry/module-registry.json`** (schema v1,
> 87 modules registered). This page is the human-readable companion + registration rules.
> Enforced by `npm run architecture:validate`.

## Registration Contract

Every production module MUST have an entry with:

```yaml
id: <layer>.<descriptiveName>        # e.g. publishing.seoMetadata  (unique; never reassign)
name:                                # human name
type: service|provider|publisher|factory|renderer|store|gate|validator|service|registry|util|entity|entrypoint
layer: publishing|news|orchestrator|ai|video|audio|thumbnail|thumbnails|uniqueness|assets|quality|broadcast|governor|pipeline|youtube|analytics|distribution|index
path: src/<layer>/<file>.mjs         # canonical file (must exist on disk)
purpose:                             # one-line role
status: active|deprecated|planned
publicApis: [...]                    # EXACT export names — validator diffs against source
tests: [...]                         # test files (must exist)
mirrorPath: deploy-staging/...       # only if mirrored (validator checks byte-identity)
dependencies: [...]                  # module ids this depends on
```

Rules:
- One module = one primary architectural responsibility (`NewsEverythingManager` forbidden).
- `publicApis` = only the cross-module surface. Internal helpers stay unlisted — making a
  method public IS a registration event.
- New module → register in JSON **before** implementation, then implement.
- Deprecation: set `status: deprecated`, record replacement in `docs/ARCHITECTURE_REGISTRY.md`
  change log, migrate callers, never hard-delete a public API in the same change.
- Do NOT create duplicate modules for existing capability. Search `docs/registry` first.

## Dependency Spine (simplified)

```text
news providers → ProductionJob → [ai story/scene] → render(audio/video) → uniqueness →
thumbnail → C2PA → UPLOAD → PUBLISH → DISTRIBUTE → VERIFY → ANALYTICS

publishing.seoMetadata (central SEO sink)
   ├── SocialPostGenerator.build   (authoritative producer)
   ├── YouTubeSEO.buildYouTubeSEO  (consumes seo.youtubeTags)
   ├── LinkedInPostFactory          (consumes seo.linkedinHashtags)
   └── scripts/composer.mjs         (builds seo once, threads projections)
```

## Layer Index

| layer | count | representative modules |
|---|---|---|
| publishing | 18 | seoMetadata, LinkedInPostFactory, SocialPostGenerator, YouTubeSEO, PublicationLedger |
| news | 3 | NewsDataProvider, RapidNewsProvider, RapidNewsBudget |
| orchestrator | 9 | ProductionJob, ProductionScheduler, Stages, StageTraceRecorder, PublishabilityGate |
| ai | 11 | StoryAlgorithmRegistry, CategoryDirector, ProviderChain, SelfHealingExecutor |
| video | 11 | SceneEngine, MotionEngine, Compositor, CaptionEngine, NarrativeTextComposition |
| audio | 4 | AudioMixer, AudioDirector, MusicFamily, MoodAnalyzer |
| thumbnail/thumbnails | 7 | ThumbnailCandidateGenerator, ThumbnailJudge, ThumbnailLifecycleManager |
| uniqueness | 4 | AssetRegistry, GlobalAssetUniquenessGate, ScriptUniqueness, MusicUniqueness |
| assets | 3 | VisualSearchEngine, DuplicateDetector, ImageDatabase |
| quality | 4 | QualityChecker, RetentionSimulator, RetentionPredictor, ViewerBehaviorModel |
| other | 13 | IntroEngine, ChannelController, NicheResolver, youtubeStudioLink, etc. |

Full schemas: open `docs/registry/module-registry.json`.

## Method Registry standard (per entry publicApis)

For each `publicApis` method, the contract lives in the module's JSDoc; the registry records
the methodId form `<moduleId>.<methodName>`. Critical cross-module contracts are documented
in `docs/DATA_CONTRACTS.md`. New public method → add to `publicApis` + contract test.

## Parameters / Constants

- Parameters: any new public parameter registers in `docs/ARCHITECTURE_REGISTRY.md` §6/§7.
  One concept = one canonical name (never `tagLimit` vs `MAX_LINKEDIN_HASHTAGS`).
- Constants: canonical table in `docs/ARCHITECTURE_REGISTRY.md` §7. Do NOT invent synonyms.

## How to register a NEW module (quick path)

1. `npm run architecture:validate` (preflight — registry/disk consistency).
2. Append entry to `docs/registry/module-registry.json` (id/name/type/layer/path/purpose/publicApis/tests/mirrorPath).
3. Add change-log entry in `docs/ARCHITECTURE_REGISTRY.md` (CHANGE-XXX).
4. Implement; run targeted tests; run full suite; run `architecture:validate`.
5. Mirror to `deploy-staging/` if deployable; `diff -q` must pass.
6. Update `docs/STACK_INDEX.md` module index row.