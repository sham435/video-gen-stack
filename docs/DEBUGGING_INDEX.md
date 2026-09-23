# DEBUGGING_INDEX.md

> Deterministic debugging paths. Start at the symptom, follow the trace.
> The old STACK_INDEX debugging table is superseded by this file (kept linked from there).

## Universal trace chain

```text
SYMPTOM
  ↓ STAGE (which pipeline stage failed)
  ↓ MODULE (docs/MODULE_REGISTRY.md → id)
  ↓ METHOD (publicApis contract)
  ↓ INPUT / OUTPUT (docs/DATA_CONTRACTS.md)
  ↓ TRACE (StageTraceRecorder / ProductionTrace)
  ↓ PERSISTED STATE (PublicationLedger / DB / data/)
  ↓ ROOT CAUSE
```

Every production operation is identified by `runId, jobId, allocationId, articleId,
artifactId, stageId, operationId` — look for them in logs before guessing.

## Quick index (symptom → module → method)

| Symptom | Stage | Module (registry id) | Method | Persisted state |
|---|---|---|---|---|
| Run failed at a stage | any | orchestrator.stages | `classifyError` / `getStage` | StageTraceRecorder |
| Video artifacts/black frames | RENDER | video.sceneEngine + video.validateOutput | `validateRenderOutput` | data/ render dir |
| Caption/narration mismatch | RENDER | video.captionEngine | `buildWordTimings`/`renderCaptions` | — |
| Audio too quiet/loud/clip | RENDER | audio.audioMixer | `AudioMixer` (−14 LUFS) | — |
| Duplicate visuals/music | UNIQUENESS | uniqueness.assetRegistry / scriptUniqueness | `rejectDuplicates`/gate | AssetRegistry (quarantine 7d) |
| Thumbnail rejected | THUMBNAIL | thumbnail.thumbnailMediaValidator | `validateThumbnailMedia` (2 MiB) | ThumbnailUploader state |
| YouTube upload/auth fails | UPLOAD | youtube.youtubeStudioLink | `getAccessToken`/`exchangeCode` | YouTubeQuotaAuditor |
| LinkedIn not native video | PUBLISH | publishing.linkedInPostFactory | `publishVideo` (needs `linkedinHashtags`) | PublicationLedger |
| LinkedIn token expired | PUBLISH | publishing.linkedInPostFactory | `introspectToken`/refresh | — |
| Hashtags wrong/missing | PUBLISH | publishing.seoMetadata FIRST → then publisher | `buildSeoMetadata` | — |
| AI provider flaky | PREFLIGHT/RENDER | ai.providerChain + ai.retry | `resolveProviderChain`/`withRetry` | modelHealth |
| C2PA/provenance errors | C2PA | pipeline.contentCredentials | `ContentCredentials` | CertificateManager |
| Not unique | UNIQUENESS | uniqueness.* | gates | AssetRegistry |
| Landing page stale | DISTRIBUTE | distribution.gitSiteDeployer | `GitSiteDeployer` | data/ feed |
| Railway vs Actions divergence | any | DOCS mirror check | `diff -q` | deploy-staging/ |
| SEO projection missing | PUBLISH | publishing.seoMetadata | check `linkedinHashtags`/`youtubeTags` present | — |

## SEO debugging (current focus)

1. Is the post missing/invalid hashtags?
2. `node -e` probe: `buildSeoMetadata(article)` → inspect `hashtags/youtubeTags/linkedinHashtags`.
3. Producer check: does the caller build via `buildSeoMetadata` (NOT `HashtagBuilder`)?
4. Consumer check: does the publisher read the projection (NOT `.slice(0,5)` / `HashtagBuilder`)?
5. Tests: `tests/seo-metadata.test.mjs`, `tests/linkedin-post-factory.test.mjs`, `tests/youtube-seo.test.mjs`.

## Deployment / mirror diagnostics

```bash
diff -q src/publishing/X.mjs deploy-staging/src/publishing/X.mjs   # must be identical
npm run architecture:validate                                        # registry/mirror/tests/disk
```

## Logging contract

New modules emit structured diagnostics:

```yaml
module, method, operationId, jobId, allocationId, duration, status, errorCode, retryCount
```

Never log bare `"something failed"` — always `module/method/id/errorCode`.