# DATA_CONTRACTS.md

> Cross-module data contracts. A contract change = registration event (change log) +
> contract test update. Producers/consumers MUST NOT silently diverge.

## 1. Normalized Article Contract

Every ingestion provider (NewsDataProvider, RapidNewsProvider, future music/SL providers)
MUST return this shape. Provider-specific fields must not leak downstream.

```yaml
article:
  id: string            # deterministic source id
  title: string         # required
  description: string
  url: string           # required
  source: string
  category: string      # required; maps via NicheResolver / NICHE_TO_ENTITIES
  publishedAt: datetime
  tags: string[]        # article-shaped tags (SEO mining)
  keywords: string[]
  language: string      # e.g. 'en' | 'si'
  market: string        # 'Global' | 'Sri Lanka'
  region: string        # ISO region or ''
  contentType: enum     # GLOBAL_NEWS | MUSIC | LOCAL_SRI_LANKA_SI
  sourceStack: string   # which stack produced it
```

Only fields required by the existing architecture are mandatory: `title, url, category`.

## 2. Central SEO Contract

```yaml
buildSeoMetadata(article, generatedContent=null) ->
  title: string          # ≤100 chars
  description: string    # keyword-rich; hashtags '#...' appended; ≤1500 chars
  hashtags: string[]     # bare lowercase; baseline-first; deduped; ≤15 (YT_MAX_TAGS)
  youtubeTags: string[]  # bare lowercase slice(0,15)
  linkedinHashtags: string[]  # '#'-prefixed slice(0,5); baseline ALWAYS present
  keywords: string[]     # story-specific search terms
```

Invariants:
- Baseline `[technology, breaking, newsmonster]` ALWAYS present, in order, exactly once.
- `dedupeTags` runs case-insensitive on the normalized (lowercase, no '#', no space) form.
- Blocklisted tags (shorts/tiktok/reels/fyp/…) never emitted.
- **One sink**: no publisher may re-derive tags. Platform projections are first-class.

Contract tests: `tests/seo-metadata.test.mjs`
- `deepEqual(linkedinPost.hashtags, seo.linkedinHashtags)`
- `deepEqual(youtubeMetadata.tags, seo.youtubeTags)` (when seo passed to buildYouTubeSEO)

## 3. ProductionJob Content Metadata

Every ProductionJob carries:

```yaml
job:
  jobId, articleId, artisanId?, stageId
  contentType: GLOBAL_NEWS|MUSIC|LOCAL_SRI_LANKA_SI
  language, market, region, sourceStack
  allocationDate, allocationSlot, allocationId
```

Enables routing/SEO/analytics/quota/uniqueness/publishing without platform hacks.

## 4. Allocation Contract

```yaml
allocation:
  allocationId         # unique
  allocationDate       # (date, slot) unique
  allocationSlot       # int slot within lane
  contentType
  status               # pending|running|published|failed
  productionJobId
  attempts
  publishedAt
rules:
  - 48/day total: GLOBAL_NEWS 24 + MUSIC 12 + LOCAL_SI 12
  - ONE central allocator; independent content crons forbidden
  - retry reuses same slot; maintenance consumes no allocation
  - no cross-lane transfer (initial)
```

## 5. Publication Ledger Contract

`src/publishing/PublicationLedger.mjs` persists per artifact:

```yaml
upload:       PENDING|SUCCESS|FAILED
thumbnail:    UPLOADED|CUSTOM_THUMBNAIL_ACCEPTED|REJECTED|UNKNOWN
verification: PENDING|NOT_VISIBLE_YET|VERIFIED|REJECTED|API_UNAVAILABLE
distribution: PENDING|IN_PROGRESS|SUCCESS|FAILED|SKIPPED
```

## 6. Events

All events registration-first. Current recognized events (add to registry when emitting):

| eventId | producer | consumers | payload keys |
|---|---|---|---|
| production.job.completed | ProductionJob | AnalyticsCollector, PublicationLedger | jobId, artifactId, contentType, publishedAt |
| distribution.platform.published | SocialDistributionManager | SocialDistributionStore | videoId, platform, postId |
| distribution.platform.failed | SocialDistributionManager | SocialDistributionStore | videoId, platform, error |

New events must register in `docs/ARCHITECTURE_REGISTRY.md` change log BEFORE emitting.

## 7. Env / Config Separation

- configuration: `.env` / registry table (`docs/ARCHITECTURE_REGISTRY.md` §6)
- secrets: env only; never in source; never committed
- runtime state: DB (`packages/database`) — NOT env
- No duplicate config sources without documented precedence (env > defaults)

## 8. Contract Test Requirements

Every producer→consumer edge needs a contract test that FAILS on shape drift:

```text
NewsProvider → Article Contract → ProductionJob
SEO Builder  → YouTube synthetic tags    (deepEqual seo.youtubeTags)
SEO Builder  → LinkedIn post hashtags    (deepEqual seo.linkedinHashtags)
SocialPostGenerator → platform text      (contains '#tag' renderings)
```