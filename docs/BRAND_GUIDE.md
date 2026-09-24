# NEWS-MONSTER BRAND DISCOVERY CONTEXT

> Permanent brand/SEO rule for every agent working in this repo.
> Authoritative SEO contract: `src/publishing/seoMetadata.mjs` + `docs/DATA_CONTRACTS.md`.
> Companion identity registry: `docs/ARCHITECTURE_REGISTRY.md` §Change Log CHANGE-002.

## Identity (canonical)

| role | value |
|---|---|
| Brand name | **NEWS-MONSTER** |
| Primary brand community hashtag | **#newsmonster** (canonical normalized form without `#`: `newsmonster`) |
| YouTube channel name | NEWS-MONSTER |
| YouTube handle | **`@news-monster`** |
| YouTube channel URL (authoritative channel link) | `https://www.youtube.com/channel/UC4UC7z16EtqtI-TJzeGZKjQ` |
| YouTube channel ID | `UC4UC7z16EtqtI-TJzeGZKjQ` |
| Landing page | `https://sham435.github.io/video-gen-stack/` |

> **IMPORTANT IDENTITY DISTINCTION:** `@newsmonster` is **NOT** currently available
> as the YouTube handle. Never assume or fabricate `@newsmonster` as the YouTube
> handle. The canonical YouTube identity is **NEWS-MONSTER** + `@news-monster` +
> the channel URL/ID above.

## Canonical hashtag rule

- `newsmonster` is **always present** in the SEO baseline.
- Baseline MUST remain, in order: `technology`, `breaking`, `newsmonster`.
- Normalize lowercase; strip `#`, whitespace, and duplicates before comparison.
- Deduplicate case-insensitively; preserve baseline order.
- Platform projections are derived from the central SEO object only —
  never create platform-specific independent hashtag logic.
- LinkedIn projection adds `#` only at the final presentation boundary.
- YouTube tags remain bare terms.

## Cross-platform architecture

```text
                        NEWS-MONSTER
                              │
                    ┌─────────┴─────────┐
                    │                   │
              YouTube Channel       LinkedIn
                    │                   │
             NEWS-MONSTER          #newsmonster
                    │                   │
              videos/content       community discovery
                    │                   │
                    └─────────┬─────────┘
                              │
                    cross-platform identity
                              │
                         #newsmonster
```

Rule: do not pretend `#newsmonster` is the YouTube handle; the Channel URL/ID is
the permanent YouTube destination (independent of handle availability).

## LinkedIn rule

Normally `#newsmonster` + **2–4 article/topic-specific** relevant hashtags.
Do NOT mechanically repeat large hashtag lists; select topic hashtags per story.

Example: `#newsmonster #technology #artificialintelligence #innovation`

## YouTube rule

Titles/descriptions/tags reinforce **NEWS-MONSTER**, `newsmonster`, and the real
story/topic. Never use an unavailable `@newsmonster` handle as a YouTube identifier.

## Brand discovery loop

```text
YouTube video
    ↓
NEWS-MONSTER brand recognition
    ↓
LinkedIn distribution
    ↓
#newsmonster discovery
    ↓
audience meets repeated NEWS-MONSTER content
    ↓
#newsmonster recognized as the NEWS-MONSTER content namespace
    ↓
audience reaches authoritative YouTube channel URL
    ↓
channel/video engagement
```

## Success measurement

Do NOT define success as hashtag views alone. Measure:
`#newsmonster` post impressions · unique reach · LinkedIn engagement · profile/Page
visits · clicks toward the YouTube channel · YouTube channel views · returning
viewers · subscribers · LinkedIn→YouTube traffic · videos associated with
`#newsmonster` · engagement rate by topic · LinkedIn→YouTube conversion.

## AI behavior rules

1. Preserve canonical `#newsmonster` identity.
2. Select topical hashtags around the story (never the same fixed set globally).
3. Never replace `#newsmonster` with arbitrary branded variants.
4. Never invent a YouTube `@handle`.
5. Never treat LinkedIn `#newsmonster` presence as proof the YouTube
   `@newsmonster` handle exists.
6. Keep the central SEO object authoritative (`buildSeoMetadata`).
7. Keep LinkedIn and YouTube projections synchronized from that object.
8. Learn which topical tag combinations drive discovery — but never remove the
   canonical `newsmonster` identity because another hashtag temporarily performs
   better.

## Enforcement

- `tests/seo-metadata.test.mjs` locks: LinkedIn projection 3–5 `#`-tags with the
  baseline (incl. `#newsmonster`) first, YouTube ≤15 bare tags, projections
  deepEqual to the central object.
- `npm run architecture:validate` fails if `BASELINE_HASHTAGS` in
  `src/publishing/seoMetadata.mjs` loses `newsmonster`.