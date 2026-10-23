# ARCHITECTURE_REGISTRY.md

> Top-level architectural registry for NEWS-MONSTER. Entry point: `docs/STACK_INDEX.md`.
> Companion registries: `docs/MODULE_REGISTRY.md`, `docs/API_REGISTRY.md`,
> `docs/DATA_CONTRACTS.md`, `docs/DEBUGGING_INDEX.md`, `docs/BRAND_GUIDE.md`.
>
> Rule: **REGISTER FIRST → DESIGN CONTRACT → IMPLEMENT → TEST → VERIFY → MIRROR → UPDATE INDEX → COMMIT.**
> No architectural object may exist only in source code.
> Machine-validation: `npm run architecture:validate` (`scripts/architecture-validate.mjs`).

---

## 1. Change Registration Log

Every architectural change is registered HERE before/with implementation.
Format (from operating doctrine §31 / §42). Appended, never rewritten.

### CHANGE-001 — Central SEO `linkedinHashtags` projection (implemented 2026-09-23)

```yaml
Change ID:        SEO-001
Reason:           LinkedIn customarily receives 3-5 '#tag'; previously LinkedInPostFactory
                  blindly re-sliced the SAME 15-tag YouTube list (.slice(0,5)) — platform
                  projections were not first-class, baseline guarantee was implicit.
Affected module(s):
  - src/publishing/seoMetadata.mjs        (central sink + projection)
  - src/publishing/SocialPostGenerator.mjs (authoritative producer)
  - src/publishing/LinkedInPostFactory.mjs (consumer, was re-slicing)
  - src/publishing/YouTubeSEO.mjs          (authoritative consumer of seo.youtubeTags)
  - scripts/composer.mjs                   (builds seo once, threads projections)
New method(s):    none (existing buildSeoMetadata extended)
Changed method(s): buildSeoMetadata (returns linkedinHashtags), buildYouTubeSEO (args.seo),
                   SocialPostGenerator.build (producer), VideoPostFormatter.format /
                   ArticlePostFormatter.format (consume linkedinHashtags)
New parameters:   none public (buildSeoMetadata output contract gained linkedinHashtags)
New constants:    MAX_LINKEDIN_HASHTAGS = 5  (canonical; replaces LI_MAX_HASHTAGS)
New configuration: none
New environment variables:  none
New database objects:       none
New routes:                 none
New events:                 none
New tests:
  - tests/seo-metadata.test.mjs (contract + projection deepEqual tests)
New deployment mirror:
  - deploy-staging/src/publishing/{seoMetadata,SocialPostGenerator,LinkedInPostFactory,YouTubeSEO}.mjs
  - deploy-staging/scripts/composer.mjs  (all byte-identical, diff -q verified)
Debug index:      docs/DEBUGGING_INDEX.md → SEO section
Deprecation:      HashtagBuilder remains legacy-compat only (do NOT add callers);
                  LinkedInPostFactory.legacyHashtagProjection is isolated compat for old tests.
```

Change graph:

```text
linkedinHashtags
   ├── seoMetadata.mjs ── MAX_LINKEDIN_HASHTAGS (canonical constant)
   ├── SocialPostGenerator.build (produces it)
   ├── LinkedInPostFactory (consumes it; no re-slice)
   ├── SocialDistributionManager/plan (promo posts render it)
   ├── scripts/composer.mjs UPLOAD→PUBLISH (threads it)
   ├── tests/seo-metadata.test.mjs
   └── deploy-staging mirror (byte-identical)
```

### CHANGE-002 — Canonical brand identity + discovery context (implemented 2026-09-23)

```yaml
Change ID:        BRAND-001
Reason:           NEWS-MONSTER identity rules were scattered/implicit. YouTube handle
                  @newsmonster is UNAVAILABLE — @news-monster + channel URL/ID are the
                  authoritative YouTube identity; #newsmonster is the cross-platform
                  community/brand hashtag. Rules must be permanent AI context.
Affected module(s): none (documentation + invariants + tests only)
  - docs/BRAND_GUIDE.md                    (NEW — permanent brand/SEO AI context)
New method(s):    none
Changed method(s): none
New constants (documented; registered here): YOUTUBE_CHANNEL_ID = UC4UC7z16EtqtI-TJzeGZKjQ,
                   YOUTUBE_CHANNEL_URL = https://www.youtube.com/channel/UC4UC7z16EtqtI-TJzeGZKjQ,
                   YOUTUBE_HANDLE = @news-monster, LANDING_PAGE =
                   https://sham435.github.io/video-gen-stack/
New configuration: none
New environment variables:  none
New database objects:       none
New routes:                 none
New events:                 none
New tests:
  - tests/seo-metadata.test.mjs → brand invariant: #newsmonster always in
    linkedinHashtags (and posts), bare newsmonster in youtubeTags/hashtags
New validator rule:
  - scripts/architecture-validate.mjs → FAIL if BASELINE_HASHTAGS loses 'newsmonster';
    warn if MAX_LINKEDIN_HASHTAGS constant disappears from seoMetadata.mjs
Deprecation:      none
```

Change graph:

```text
#newsmonster
   ├── src/publishing/seoMetadata.mjs ── BASELINE_HASHTAGS (canonical, order-locked)
   ├── src/publishing/SocialPostGenerator.mjs (produces projections)
   ├── src/publishing/LinkedInPostFactory.mjs (renders '#'-prefixed projection)
   ├── src/publishing/YouTubeSEO.mjs (bare tags)
   ├── docs/BRAND_GUIDE.md (permanent AI context)
   ├── tests/seo-metadata.test.mjs (locked invariants)
   └── scripts/architecture-validate.mjs (brand-baseline FAIL rule)
```

### CHANGE-003 — Landing page conversion CTA + UTM attribution (implemented 2026-09-25)

```yaml
Change ID:        LANDING-001
Reason:           NEWS-MONSTER videos close with an end-screen CTA to the landing page.
                  The landing page must receive + persist first-touch UTM attribution
                  (?utm_source/utm_medium/utm_campaign/utm_content), forward it to
                  internal conversion links, and expose a prominent "Free AI Tools &
                  Downloads" CTA — while keeping the 16:9 video-feed architecture and
                  the /video-gen-stack/ URL as the single authoritative destination
                  (newsmonster.link is NOT a configured destination and is NOT introduced).
Affected module(s):
  - public/index.html                    (landing page — static artifact, GH Pages)
New method(s):    readUtmFromUrl, loadStoredUtm, saveStoredUtm, captureUtm,
                  decorateUtmLinks (all scoped inside the page's inline IIFE)
Changed method(s): init (calls decorateUtmLinks), nav/CTA markup added
New constants (documented here): UTM_KEYS = [utm_source, utm_medium, utm_campaign,
                   utm_content]; UTM_STORAGE_KEY = 'newsmonster:utm:v1'
New configuration: none
New environment variables:  none
New database objects:       none
New routes:                 none
New events:                 none
New tests:
  - tests/landing-page-utm.test.mjs (first-touch persistence, storage-unavailable,
    link decoration, source-hygiene static checks)
New deployment mirror:      none (public/index.html is NOT mirrored to deploy-staging;
                   deploy-staging/public/ holds only videos.json + video-detail.json)
BRAND-001:        preserved — NEWS-MONSTER name, #newsmonster policy untouched;
                  16:9-only presentation unchanged; no @newsmonster fabrication.
Deprecation:      none
```

Change graph:

```text
landing UTM
   ├── public/index.html ── UTM_KEYS / UTM_STORAGE_KEY (client-side, first-touch)
   ├── CTA band + nav CTA (href="./" → /video-gen-stack/, data-utm decorated)
   ├── tests/landing-page-utm.test.mjs (behavioral + static)
   └── docs/BRAND_GUIDE.md LANDING_PAGE constant (unchanged, authoritative)
```

---

### CHANGE-004 — Accumulated production feed + deploy cascade repair (implemented 2026-09-26)

```yaml
Change ID:        FEED-001
Reason:           The live landing page served only 2 videos because (a) bot feed
                  commits were pushed with GITHUB_TOKEN → GitHub intentionally does
                  NOT re-trigger on:push workflows, so deploy.yml never ran and the
                  Pages site froze at the last human push (db607c0, carrying a stale
                  Sep-22 videos.json); (b) update-videos.mjs preferred the per-run
                  scratch ledger (output/data) over accumulated durable sources, so
                  videos.json collapsed to the current run's 1-3 entries and the 31
                  historical verified publications in production/runs/ were discarded.
Affected module(s):
  - scripts/update-videos.mjs            (feed accumulation — merges all durable sources)
  - .github/workflows/publish-news.yml   (explicit deploy.yml dispatch after push)
  - scripts/composer.mjs                 (unchanged — already writes ledger to data/ + output/data)
New method(s):    mergeVerifiedPublicationSources (pure, exported, unit-tested),
                  readAccumulatedPublications, toVideoEntry
Changed method(s): refreshVideosFeed (accumulated, newest-first, dedupe by videoId)
New configuration: publish-news.yml permissions += actions: write (needed for
                   `gh workflow run`; workflow_dispatch via GITHUB_TOKEN is the
                   documented anti-recursion exception and cannot loop)
New environment variables:  none
New database objects:       none
New routes:                 none
New events:                 workflow_dispatch on deploy.yml (already declared) fired
                   explicitly by publish-news.yml only after a successful feed push
New tests:
  - tests/update-videos-accumulate.test.mjs (dedupe by videoId, rejection rules,
    gallery metadata enrichment without fabrication, empty-source safety)
New deployment mirror:      none
BRAND-001:        preserved — no branding changes; production evidence untouched.
Deprecation:      none
```

Change graph:

```text
production/runs/{jobDir}/publication.json  ◄── committed verification evidence (32 runs)
             +
PublicationLedger (data/ + output/data)    ◄── ledger (3-axis verified state)
             +
public/videos/{videoId}.json               ◄── committed gallery metadata (enrichment only)
             │
             ▼
update-videos.mjs  (mergeVerifiedPublicationSources → dedupe → newest-first)
             │
             ▼
public/videos.json  (accumulated verified feed, source=production-ledger)
             │
             ▼
publish-news.yml bot commit/push (GITHUB_TOKEN)
             │
             ▼
dispatch_deploy → gh workflow run deploy.yml --ref main  (workflow_dispatch, no recursion)
             │
             ▼
GitHub Pages → NEWS-MONSTER landing page feed
```

Acceptance note (corrected): the earlier TREE-CONSERVED check proved db607c0 kept its
original tree — but that tree itself contained the stale public/videos.json, so the
conserved tree carried a feed regression. FEED-001 repairs both the feed accumulation
and the deploy cascade rather than rewriting history.

---

### CHANGE-005 — Public availability reconciliation (implemented 2026-09-26)

```yaml
Change ID:        FEED-002
Reason:           SUCCESS at publication time ≠ PUBLIC forever. On 2026-09-26 a live
                  check of the 57-video accumulated feed showed only 34 PUBLIC
                  (22 DELETED + 1 UNLISTED). The client-facing landing page was
                  rendering ~23 dead "Video unavailable" cards. History must be
                  preserved; the DISCOVERABLE feed must be filtered.
Affected module(s):
  - scripts/availability.mjs             (NEW — availability reconciliation)
  - scripts/update-videos.mjs            (feed gate: applyAvailabilityGate inserted
                                          between schema validation and publish)
  - .github/workflows/publish-news.yml   (refresh step now passes YOUTUBE_* OAuth env)
New method(s):    classifyPrivacyStatus, chunkIds, getAccessToken, checkBatchAvailability
                  (live videos.list?part=status, ≤50 ids/call), readAvailabilityState,
                  writeAvailabilityState, applyAvailabilityGate (pure, exported, tested)
Changed method(s): refreshVideosFeed — accumulated → dedupe → schema → availability
                  gate → PUBLIC only → public/videos.json
New configuration: none
New environment variables: YOUTUBE_API_KEY (optional; OAuth trio already used by
                  compose/verify steps is the default auth)
New database objects: none
New persistent state: data/availability-state.json (gitignored, cache-persisted via
                  newsroom-data-main — append-only per videoId, never deletes history;
                  records PUBLIC/PRIVATE/UNLISTED/DELETED/UNKNOWN + checkedAt)
New routes:       none
New events:       none
New tests:
  - tests/update-videos-availability.test.mjs (19 assertions: privacy classification,
    batching ≤50, live-deleted, live-private, quota/5xx fail-closed UNKNOWN, network
    fail-closed, mixed batch, gate PUBLIC-only, missing-map fail-closed, ordering +
    schema preservation, no input mutation, availability tags, historical removal,
    all-unavailable → empty feed, duplicate-id dedupe)
New deployment mirror: none
BRAND-001:        preserved — no branding changes.
Deprecation:      none
```

Change graph:

```text
accumulated publication sources (ledger + production/runs + detail pages)
              │
              ▼
mergeVerifiedPublicationSources → dedupe by videoId
              │
              ▼
toVideoEntry → schema validation
              │
              ▼
YouTube availability reconciliation   ◄── FEED-002 (scripts/availability.mjs)
   PUBLIC │ PRIVATE │ UNLISTED │ DELETED │ UNKNOWN
     │     └────────┴──────────┴─────────┴────────┘  → data/availability-state.json
     ▼                                            (history retained, hidden from feed)
public/videos.json (PUBLIC only, newest-first)
              │
              ▼
publish-news.yml bot commit/push (GITHUB_TOKEN)
              │
              ▼
dispatch_deploy → gh workflow run deploy.yml --ref main
              │
              ▼
GitHub Pages → NEWS-MONSTER landing page feed (static, deterministic, zero client
               YouTube calls)
```

Acceptance note: the landing page NEVER calls the YouTube API itself — reconciliation
happens entirely in the GitHub Action upstream. Client rendering stays fast/static and
deterministic; a deleted video disappears from the feed at the next refresh cycle while
its record persists in production/runs + the ledger + availability-state.json.

---

### CHANGE-006 — YouTube credential failure must fail loud + name its cause (implemented 2026-10-22)

```yaml
Change ID:        PUBLISH-001
Reason:           On 2026-10-17 a full audit of 18 consecutive "successful" publish runs
                  (2026-09-29 → 2026-10-17) showed EVERY upload had failed with
                  `YOUTUBE_API_ERROR: HTTP 400` and the article was quarantined. The job
                  still exited 0, so notify-failure never fired: the channel silently went
                  dark for 18 days. Locally reproducing the token refresh proved the real
                  cause — Google's OAuth token endpoint returns HTTP 400 with
                  `{"error":"invalid_grant","error_description":"Bad Request"}`, where
                  `error` is a STRING. `youtubeApiError()` only read `error.message`, so a
                  revoked/expired refresh token collapsed to a meaningless bare "HTTP 400".
                  A systemic credential failure must (a) name its cause and (b) fail the run.
Affected module(s):
  - apps/api/publishers/youtube.js    (youtubeApiError: parse OAuth error shape +
                                       isAuthError classification)
  - scripts/composer.mjs              (fail-fast credential verification before render;
                                       non-zero exit on unusable credential)
New method(s):    none (youtubeApiError is internal; getAccessToken unchanged)
Changed method(s): youtubeApiError — reads OAuth `error`/`error_description` when `error`
                  is a string; sets `err.reason` from the OAuth code; sets
                  `err.isAuthError` for invalid_grant/invalid_client/…/401.
                  composer runFull — verifies getAccessToken({force:true}) after the
                  production preflight; exits 1 on isAuthError / missing OAuth config;
                  warns (continues) on transient network/5xx.
New configuration: none
New environment variables: none
New database objects: none
New persistent state: none
New routes:       none
New events:       none
New tests:
  - tests/youtube-auth-error.test.mjs (4 assertions: invalid_grant surfaced not bare
    "HTTP 400" + isAuthError; 401 object-shape flagged; 500 not flagged as auth;
    YouTube Data API quota error keeps message/reason and is not auth)
New deployment mirror: none
BRAND-001:        preserved — no branding changes.
Deprecation:      none
```

Change graph:

```text
publish-news.yml (schedule */30)
      │
      ▼
composer runFull
      │
      ├─ ProductionPreflight.run()  ── pre-existing gate
      │
      ├─ [NEW] getAccessToken({force:true})
      │        │
      │        ├─ invalid_grant ──► [AUTH] FATAL → exit 1 → notify-failure issue/email
      │        │                    (no 10-minute render wasted, no silent dry spell)
      │        └─ OK ──► render → UPLOAD → YouTube
      │
      ▼
youtubeApiError(): OAuth string shape → "YOUTUBE_API_ERROR: invalid_grant: Bad Request"
                   (+ isAuthError) · API object shape → unchanged
```

Operational requirement (NOT code): the refresh token that failed was revoked/expired.
Re-authorize with `node scripts/youtube-oauth.mjs`, then
`gh secret set YOUTUBE_REFRESH_TOKEN`. If the Google OAuth consent screen is in
"Testing", refresh tokens expire after 7 days — publish the app to stop the weekly
expiry that caused this outage.

---

### CHANGE-007 — An availability outage must never blank the public feed (implemented 2026-10-22)

```yaml
Change ID:        FEED-003
Reason:           Cascade of PUBLISH-001. Because the refresh token died on
                  2026-09-29, the availability live check could no longer observe
                  any video. checkBatchAvailability correctly returns UNKNOWN per
                  id on 401/403/quota/network, but update-videos.mjs treated that
                  map as authoritative: it persisted 85 UNKNOWN records over 34
                  good PUBLIC ones, the gate then excluded everything ("fail
                  closed"), and an EMPTY public/videos.json was committed and
                  deployed. The landing page was blank for ~3 weeks (2026-09-29 →
                  2026-10-22) — the worst possible outcome for a site that is the
                  LinkedIn CTA destination. An outage is a failure to OBSERVE,
                  never a verdict about the videos.
Affected module(s):
  - scripts/availability.mjs     (NEW mergeAuthoritativeState, hasUnverifiedExclusion)
  - scripts/update-videos.mjs    (use them; refuse to write an empty feed when any
                                  exclusion is unverified)
New method(s):    mergeAuthoritativeState, hasUnverifiedExclusion
Changed method(s): update-videos refreshVideosFeed — availability state is now
                  merged (UNKNOWN never overwrites known state, never persisted);
                  an empty feed is written ONLY when every video is
                  authoritatively DELETED/PRIVATE/UNLISTED.
New configuration: none
New environment variables: none
New database objects: none
New persistent state: none (data/availability-state.json schema unchanged)
New routes:       none
New events:       none
New tests:        9 added to tests/update-videos-availability.test.mjs (27 total)
New deployment mirror: none
BRAND-001:        preserved.
Deprecation:      none
```

Invariant established:

> `public/videos.json` may only SHRINK when the shrink is explained by
> authoritative per-video verdicts. If any video is UNKNOWN, the existing feed
> is preserved and the run reports the outage.

Evidence: locally reproducing the incident (57 records poisoned to UNKNOWN,
credential unusable) now logs
`❌ refusing to write an empty feed — 57 of 57 video(s) could not be verified
(UNKNOWN). Keeping the existing feed unchanged.` and the 34-video feed survives.

---

## 2. Content-Type Registry (canonical, one concept = one name)

| contentType | language | market | region | sourceStack | allocation/day | status |
|---|---|---|---|---|---|---|
| `GLOBAL_NEWS` | en | Global | — | newsapi/rapidnews | 24 | active |
| `MUSIC` | en | Global | — | (to register) | 12 | planned |
| `LOCAL_SRI_LANKA_SI` | si | Sri Lanka | LK | (to register) | 12 | planned |

Total hard limit: **48 videos/day** — ONE central allocator (§ all other scheduler additions are forbidden).

Do NOT introduce synonyms: `type`, `kind`, `newsType`, `mediaType`, `content_type` are all `contentType` = `ProductionJob.contentType`.

## 3. Allocation Contract (48/24/12/12)

```yaml
allocations:
  GLOBAL_NEWS: 24       # lane: 24/day
  MUSIC:       12       # lane: 12/day
  LOCAL_SI:    12       # lane: 12/day
  total:       48       # HARD LIMIT — never exceeded
rules:
  - ONE central allocator (no independent content crons)
  - allocationId = (date, slot); slot uniqueness enforced; (date, slot) unique
  - retries reuse the same slot
  - maintenance does not consume allocation
  - unused allocation does NOT transfer between lanes (initial impl)
identity:
  allocationId, allocationDate, allocationSlot, contentType,
  status, productionJobId, attempts, publishedAt
```

## 4. Pipeline Stage Registry

Source of truth: `src/orchestrator/Stages.mjs` (STAGES, FailureClass, classifyError).
Add a stage ONLY after registering here (`stageId/name/position/purpose/input/output/
dependencies/failureClass/retryable/checkpoint/timeout/metrics/tests`).

| stageId | position | purpose | failureClass | retryable | checkpoint |
|---|---|---|---|---|---|
| DISCOVER | 1 | ingest + categorize article | FETCH | true | yes |
| PREFLIGHT | 2 | validate inputs/capacity | VALIDATION | false | yes |
| RENDER | 3 | canvas→FFmpeg video | RENDER | true | yes |
| THUMBNAIL | 4 | candidate gen + judge + select | THUMBNAIL | true | yes |
| C2PA | 5 | content provenance signing | SIGNING | false | yes |
| UNIQUENESS | 6 | global uniqueness gate | UNIQUENESS | false | yes |
| UPLOAD | 7 | YouTube upload (SEO snippet) | UPLOAD | true | yes |
| PUBLISH | 8 | LinkedIn native + fans | PUBLISH | false | yes |
| DISTRIBUTE | 9 | promo posts (optional) | DISTRIBUTE | false | yes |
| VERIFY | 10 | propagation + post verification | VERIFY | true | yes |
| ANALYTICS | 11 | ingestion of metrics | ANALYTICS | false | yes |

## 5. Provider Registry

| providerId | capability | module | auth/env | fallback | status |
|---|---|---|---|---|---|
| news.newsdata | news-ingestion | src/news/NewsDataProvider.mjs | NEWSDATA_API_KEY | news.rapidnews | active |
| news.rapidnews | news-ingestion | src/news/RapidNewsProvider.mjs | NEWSAPI_KEY | — | active |
| ai.zen | llm | src/ai/providers/ZenProvider.mjs | ZEN_SESSION_TOKEN | chain-order | active |
| ai.openrouter | llm | src/ai/providers/OpenRouterProvider.mjs | OPENROUTER_API_KEY | chain-order | active |
| ai.gemini | llm | src/ai/providers/GeminiProvider.mjs | GEMINI_API_KEY | chain-order | active |
| ai.ollama | llm | src/ai/providers/OllamaProvider.mjs | OLLAMA_HOST | chain-order | local-only |
| ai.openai | llm | src/ai/providers/OpenAIProvider.mjs | OPENAI_API_KEY | chain-order | active |
| tts.elevenlabs | tts | (voice pipeline) | ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID | fallback tts | active |
| publish.youtube | publisher | apps/api/publishers/youtube.js | YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN | — | active |
| publish.linkedin | publisher | apps/api/publishers/linkedin.js | LINKEDIN_CLIENT_ID/SECRET, LINKEDIN_ACCESS_TOKEN, LINKEDIN_MEMBER_URN | — | active |
| publish.tiktok | publisher | apps/api/publishers/tiktok.js | TIKTOK_CLIENT_KEY/SECRET/ACCESS_TOKEN | — | active |
| media.pexels | visual | src/assets/VisualSearchEngine.mjs | PEXELS_API_KEY | image DB | active |
| auth.youtube | oauth | src/youtube/youtubeStudioLink.mjs | YOUTUBE_REFRESH_TOKEN | — | active |
| auth.linkedin | oauth | src/publishing/LinkedInPublisher.mjs | LINKEDIN_CLIENT_ID/SECRET, LINKEDIN_REDIRECT_URI | — | active |
| auth.tiktok | oauth | apps/api/routes/publish.js | TIKTOK_CLIENT_KEY/SECRET | — | active |

Rule: never silently add a provider; never hardcode keys; register + env + contract + tests first.

## 6. Environment Variable Registry

Registered here BEFORE any `process.env.*` reference. `secret:true` vars must NOT be committed;
they exist in `.env` / GitHub Actions secrets / Railway.

| name | purpose | required | secret | consumer |
|---|---|---|---|---|
| GEMINI_API_KEY | AI llm | no | yes | ai.providers |
| YOUTUBE_CLIENT_ID | YouTube OAuth | no (token-mode ok) | yes | auth.youtube |
| YOUTUBE_CLIENT_SECRET | YouTube OAuth | yes (oauth-mode) | yes | auth.youtube |
| YOUTUBE_REFRESH_TOKEN | YouTube OAuth | yes | yes | auth.youtube |
| YOUTUBE_PRIVACY | snippet privacy (private/unlisted/public) | no | no | publishers/youtube |
| NEWSAPI_KEY | RapidNews ingestion | yes | yes | news.rapidnews |
| NEWSDATA_API_KEY | NewsData ingestion | no | yes | news.newsdata |
| ELEVENLABS_API_KEY | TTS | no | yes | tts.elevenlabs |
| ELEVENLABS_VOICE_ID | TTS voice | no | no | tts.elevenlabs |
| PORT | API server | no (default 3000) | no | apps/api |
| TIKTOK_CLIENT_KEY | TikTok OAuth | optional | yes | auth.tiktok |
| TIKTOK_CLIENT_SECRET | TikTok OAuth | optional | yes | auth.tiktok |
| TIKTOK_ACCESS_TOKEN | TikTok publish | optional | yes | publish.tiktok |
| LINKEDIN_CLIENT_ID | LinkedIn OAuth/self-heal | yes (workflow) | yes | auth.linkedin |
| LINKEDIN_CLIENT_SECRET | LinkedIn OAuth/self-heal | yes (workflow) | yes | auth.linkedin |
| LINKEDIN_REDIRECT_URI | LinkedIn OAuth callback | yes (oauth) | no | auth.linkedin |
| LINKEDIN_ACCESS_TOKEN | LinkedIn publish | yes (workflow) | yes | publish.linkedin |
| LINKEDIN_REFRESH_TOKEN | LinkedIn token refresh | optional | yes | LinkedInPostFactory |
| LINKEDIN_MEMBER_URN | LinkedIn owner | yes (workflow) | no | publish.linkedin |
| LINKEDIN_ORG_SOCIAL | org-posting flag =1 | no | no | LinkedInPostFactory |
| LINKEDIN_ORG_ID / LINKEDIN_ORGANIZATION_URN | company target | no | no | LinkedInPostFactory |
| LINKEDIN_POST_TARGETS | profile/company/both | no | no | LinkedInPostFactory |
| TEST_PUBLISH | =1 skips social fan-out | no | no | composer |
| ASSET_REGISTRY_PATH | registry override (test isolation) | no | no | AssetRegistry |
| PEXELS_API_KEY | stock visuals | yes | yes | media.pexels |
| RENDER_ASPECT | short/standard output | no | no | render pipeline |
| DATABASE_URL | persistence | optional | no | packages/database |

Code MUST NOT reference unregistered env vars. `architecture:validate` warns on unknown `process.env.*`.

### CHANGE-008 — Production memory must survive cache restores — no story ships twice via the ledger (implemented 2026-10-23)

```yaml
Change ID:        FEED-004
Reason:           2026-10-23 19:29–20:14 incident. actions/cache used the
                  static key 'newsroom-data-main'. Once a run's restore hit the
                  exact key, the post-save step refused to write ("Cache hit
                  occurred on the primary key, not saving cache"), so
                  data/publish-events.json — the PublishEventsStore dedup
                  ledger — was frozen at the snapshot from whenever the key was
                  first created. Every run re-fetched the same top stories and
                  re-uploaded them: eight videos total, five duplicates
                  (Apple iPhone Duo x4, Galaxy S27 x2, ASUS x2 by the time
                  detection completed). [DEDUP] never fired because the ledger
                  each run saw was empty or stale.
Affected module(s):
  - .github/workflows/publish-news.yml
      restore steps:   key rotated to newsroom-data-${{ github.run_id }}
                       (restore-keys prefix newsroom-data- stays; exact key
                       never pre-exists, so the restore post-save now always
                       writes a fresh snapshot)
      persist step:    actions/cache/save@v5 with
                       newsroom-data-${{ github.run_id }}-persist — always saves
      NEW seeder step: union-merges data/publish-events.json with titles from
                       the committed public/videos.json (suffix stripped,
                       slice(0,90)) every run — a stale or partial ledger is
                       healed, and a full cache eviction (GHA ~7-day TTL) can
                       no longer wipe cross-run dedup knowledge
  - scripts/composer.mjs
      dedup compare    normalized to slice(0,90) on BOTH sides: the marker
                       stored slice(0,100) of article.title while the compare
                       used the full string, so any article longer than 100
                       chars never matched (mirror of uploadTitle =
                       article.title.slice(0,90) + ' | NEWS-MONSTER')
Commits: 847488f (static ffmpeg, apt eliminated), d79334d (cache rotation +
         seeder), 6293c08 (seeder union-merge + slice normalization)
New configuration: none
New environment variables: none
New database objects: none
New persistent state: data/publish-events.json — now ALWAYS persisted each run
                      (previously frozen); seeder derives supplementary entries
                      from public/videos.json
New routes: none
New events: none
New tests: none (workflow-level cache semantics; verification was live-run
           based: run 40019159390 shows '[DEDUP] skipped 1' + fresh upload)
New deployment mirror: none
BRAND-001: preserved.
Deprecation: none
```

Invariant established:

> The publish pipeline's memory of what it already shipped must have at least
> two independent persistence paths (per-run cache SNAPSHOT + committed feed),
> and a stale partial ledger is an expected input to heal, not a reason to
> trust it.

### CHANGE-009 — Ground-truth channel guard: ask YouTube before shipping (implemented 2026-10-23)

```yaml
Change ID:        FEED-005
Reason:           2026-10-23 20:44 residual incident. Even with FEED-004, a run
                  dispatched minutes behind another restored a prefix-matched
                  older cache snapshot taken BEFORE the prior run's persist
                  (legitimate restore-keys semantics), raced past its feed
                  commit, and re-published the ASUS story (pajBf1Y0Pmc) nine
                  minutes after uUryMpO-Bo8. Ledger/seeder layers are only as
                  fresh as their writers; the only source that cannot lie about
                  what the channel just shipped is the channel itself. Guard is
                  placed in the UPLOAD stage before any upload cost; two cheap
                  API calls (channels.list mine -> uploads playlist -> last 30
                  titles) then normalized the same way as the ledger
                  (suffix strip, lowercase, slice(0,90)). Exact match aborts
                  the article with DUPLICATE_RECENT_UPLOAD. Transient API
                  errors fail OPEN (availability beats redundancy; two ledger
                  layers remain always-on).
Affected module(s):
  - src/publishing/RecentUploadGuard.mjs   (NEW: normalizePublishedTitle,
                                            getRecentlyUploadedTitles — 10-min
                                            per-process TTL)
  - scripts/composer.mjs                   (UPLOAD stage calls the guard right
                                            after computing uploadTitle)
Commits: 9daf33a
New configuration: none
New environment variables: none (uses the same YOUTUBE_* OAuth cred path as
                            the publisher itself)
New database objects: none
New persistent state: none (10-min in-process cache only)
New routes: none
New events: none
New tests: none
New deployment mirror: none
BRAND-001: preserved.
Deprecation: none
```

Invariant established:

> No video reaches the upload API unless the channel's own recent-upload
> window (last 30 titles, normalized) does not already contain the exact
> normalized story title. Cache and git are hints; the channel is truth.

## 7. Constant Registry (canonical names)

One concept = one canonical name. Do not create synonyms.

| constant | module | purpose | value/range | env override |
|---|---|---|---|---|
| MAX_LINKEDIN_HASHTAGS | publishing.seoMetadata | LinkedIn tag cap | 5 | no |
| YT_MAX_TAGS | publishing.seoMetadata | YouTube snippet tag cap | 15 | no |
| YT_MAX_TAG_CHARS | publishing.seoMetadata | per-tag char cap | 100 | no |
| BASELINE_HASHTAGS | publishing.seoMetadata | mandatory brand tags | [technology, breaking, newsmonster] | no |
| YOUTUBE_CHANNEL_ID | brand identity (BRAND-001) | authoritative YouTube channel | `UC4UC7z16EtqtI-TJzeGZKjQ` | no |
| YOUTUBE_CHANNEL_URL | brand identity (BRAND-001) | authoritative YouTube link | `https://www.youtube.com/channel/UC4UC7z16EtqtI-TJzeGZKjQ` | no |
| YOUTUBE_HANDLE | brand identity (BRAND-001) | YouTube handle — NOT `@newsmonster` (unavailable) | `@news-monster` | no |
| LANDING_PAGE | brand identity (BRAND-001) | landing page | `https://sham435.github.io/video-gen-stack/` | no |
| BRAND_TAGS | publishing.YouTubeSEO | YouTube brand tags | NEWS-MONSTER set | no |
| DEFAULT_YOUTUBE_CATEGORY_ID | publishing.YouTubeSEO | fallback category | '28' | no |
| RAPID_NEWS_DAILY_LIMIT | news.RapidNewsBudget | per-day fetch budget | (see module) | no |
| GLOBAL_DAILY_ALLOCATION | (future allocator) | lane cap | 24 | no |
| MUSIC_DAILY_ALLOCATION | (future allocator) | lane cap | 12 | no |
| LOCAL_SI_DAILY_ALLOCATION | (future allocator) | lane cap | 12 | no |
| QUARANTINE_DAYS | uniqueness.AssetRegistry | asset quarantine | 7 | no |
| MAX_YOUTUBE_THUMBNAIL_BYTES | thumbnail.* | YouTube thumb cap | 2 MiB | no |
| LINKEDIN_MAX_COMMENTARY | publishing.* | commentary cap | 1500 | no |

## 8. Error Registry

Every important error gets a code + failureClass (do not rely on free-form messages).
Failure classes live in `src/orchestrator/Stages.mjs`.

| code | failureClass | retryable | module | diagnostic |
|---|---|---|---|---|
| SEO_METADATA_INVALID | VALIDATION | false | publishing.seoMetadata | invalid article input |
| LINKEDIN_TOKEN_EXPIRED | AUTH | true (refresh) | LinkedInPostFactory | inactive token |
| UPLOAD_REQUIRES_VIDEO | UPLOAD | false | composer UPLOAD | missing final.mp4 |
| UPLOAD_REQUIRES_THUMBNAIL | UPLOAD | false | composer UPLOAD | missing thumb |
| LeaseConflictError | GOVERNOR | false | governor.ChannelController | lease conflict |
| QuotaExhaustedError | GOVERNOR | false | governor.ChannelController | quota/48-day ceiling |
| ProductionError | VALIDATION | false | orchestrator.PublishabilityGate | gate rejection |

## 9. Debug Identity

Every significant production operation carries: `runId, jobId, allocationId, articleId,
artifactId, stageId, operationId`. Trace order:
`allocationId → ProductionJob → article → render → thumbnail → C2PA → uniqueness → upload → publication → distribution → verification → analytics`
(follow docs/DEBUGGING_INDEX.md).

## 10. Mirror Registry (Railway)

| canonical | mirror | sync | validation |
|---|---|---|---|
| src/publishing/*.mjs | deploy-staging/src/publishing/*.mjs | manual-byte-sync | diff -q |
| scripts/composer.mjs | deploy-staging/scripts/composer.mjs | manual-byte-sync | diff -q |

Intentionally NOT mirrored: `docs/*` (not deployed), `tests/*` (Railway has no test runtime),
`scripts/architecture-validate.mjs` (dev tooling, not needed by Railway runtime),
`apps/api` runtime deps beyond composer-owned auth (document any future exception here).

Do NOT manually implement two subtly different versions — modify canonical → test → mirror → diff.

## 11. Registry Consistency Test (`npm run architecture:validate`)

Detects (v1, incremental): registered module missing from filesystem · missing test file ·
missing mirror + mirror drift · declared public API not exported · unknown `process.env.*`
referenced in source but absent from `.env.example` (report). Future versions: duplicate
parameters, duplicate routes, duplicate constants, duplicate content types, missing tests.

Never bypass this gate before a pipeline commit.

## 12. Validation Backlog (from v1, 2026-09-23 — 105 warnings, exit 0)

Actionable, NOT blocking. Each item = register or document; fix incrementally.

- **Env vars used but absent from `.env.example`** (~90, e.g. `ZEN_API_KEY`, `ZEN_BASE_URL`,
  `ZEN_MODEL`, `ZEN_SESSION_ID`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_UPLOAD_CHUNK_SIZE`,
  `YOUTUBE_UPLOAD_TIMEOUT_MS`, `YOUTUBE_DAILY_QUOTA`, `YOUTUBE_OAUTH_TOKEN`, …).
  Resolution: add documented rows to `.env.example` + §6 table; do NOT change runtime defaults.
- **Unregistered public exports** (~14): `YouTubeSEO → HashtagBuilder` (re-export compat),
  `ThumbnailLifecycleManager → default`, `ScriptUniqueness → EMPTY_SCRIPT_HASH`,
  `NarrativeTextComposition → ACTIVE_OPACITY/blockFor/overlaps/textLayoutDiagnostics`.
  Resolution: register in module-registry.json publicApis OR mark internal + stop exporting.
- Wiring the validator into `.github/workflows/ci.yml` (commit gate) once warnings == 0.

Do NOT fix this backlog inside a feature change — separate registry-hygiene task.