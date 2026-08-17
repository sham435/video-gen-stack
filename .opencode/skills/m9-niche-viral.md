# Skill: M9 — Niche Viral Engine (48 Hashtag Sets + Arc CTA)

Use this when optimizing YouTube descriptions for maximum reach, building hashtag strategies,
or creating engagement CTAs for the 48-algorithm diversity engine.

## Key facts
- `HashtagBuilder.build({ algorithm })` returns 15 unique hashtags per algo (base+category+visual+tone+arc+hook+niche)
- `TopicCtaBuilder.build(article)` returns arc-specific CTA + pinned comment + followUp
- `PublishingEnhancer.enhance({ title, category, source })` combines everything into full description
- Each of 48 algos gets a completely different hashtag set — YouTube never sees duplicate content
- 6 arc CTAs map to monkey-empathy narratives: shelter, kindness, comeback, rescue, creativity, reunion

## Hashtag structure (15 tags per algo)
1. Base: `news-monster breaking news`
2. Category: 3 tags (e.g. `ai artificialintelligence machinelearning`)
3. Visual: 2 tags (e.g. `documentary noir`)
4. Tone: 2 tags (e.g. `breakingnews urgent`)
5. Arc: 2 tags (e.g. `shelter love`)
6. Hook: 1 tag (e.g. `nobodyexpected`)
7. Niche: 2 viral tags (e.g. `viral shorts`)

## Arc CTA mapping
| Arc | CTA | Viral trigger |
|-----|-----|--------------|
| RAIN_SHELTER_LOVE | "Have you ever built shelter in the rain?" | Personal story = comments |
| HUNGER_SHARE_HERO | "Have you ever shared when you had nothing?" | Kindness story = shares |
| BULLY_STUDY_SUCCESS | "Were you ever counted out?" | Underdog story = engagement |
| RIVER_SAVE_FISH | "Have you ever saved someone while drowning?" | Rescue story = saves |
| BROKEN_FIX_INSPIRE | "Have you fixed something broken?" | Innovation story = follows |
| LEFT_RUN_REUNION | "Have you ever run to reunite?" | Reunion story = emotional |

## Usage
```js
import { PublishingEnhancer } from './src/publishing/PublishingEnhancer.mjs'
const enh = PublishingEnhancer.enhance({
  title: 'Trump OKs crypto banking',
  category: 'business',
  source: 'Politico',
  algorithm: pickAlgorithm({ title, category }),
})
// enh.fullDescription — ready for YouTube
// enh.pinnedComment — engagement question
// enh.hashtags — 15 tags
```

## Rules
1. Never use generic hashtags — always use `HashtagBuilder.build({ algorithm })` for 48-algo content
2. CTA must match the arc — a RAIN_SHELTER_LOVE story must ask about shelter, not comebacks
3. `dupPhotos` must stay 0 — hashtags don't fix photo reuse
4. Verify with `node verify-m9.mjs` after any change
