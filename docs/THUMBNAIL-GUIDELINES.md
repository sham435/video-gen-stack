# NEWS-MONSTER Thumbnail Guidelines

The thumbnail is the **headline of the headline**. It must communicate the story
in under 2 seconds at smartphone size, and earn a click without misleading.

**Why it matters:** viewers scroll past a video in under a second. A weak
thumbnail means low click-through rate (CTR), which means the algorithm stops
recommending the video. The thumbnail is the single highest-leverage frame in
the pipeline — a good strategy measurably lifts views, retention, and channel
growth.

**How to measure:** track CTR weekly. Anything at or under 4% needs a thumbnail
refresh.

---

## The 10-foot rule (pre-ship gate)

Shrink the thumbnail to the size of a thumb on a phone. If you cannot read the
text or identify the subject, redo it. This is the final QA gate before any
thumbnail reaches a feed.

---

## Rule 1 — One subject, one idea

One person, object, or bold text element in the frame — never a collage.

| ✅ Do | ❌ Don't |
|------|---------|
| A politician's face + "COST OF LIVING" (3 words) | A grid of four small images + two text blocks |
| One live event photo telling the story | A stock illustration of a generic concept |

**Code hook:** `ThumbnailGenerator.drawSplitLayout` (src/visuals/ThumbnailGenerator.mjs:54)
already keeps structure simple — do not add more than one photo region plus text.

## Rule 2 — Text: 3–5 words, huge, high-contrast

Use **3–5 words max** at ≥72px with a dark outline or scrim so they stay
legible at tiny sizes. At minimum, **copy the title word-for-word — the
thumbnail adds a hook, it does not duplicate the title**.

Current implementation already enforces the split:
- **Primary:** first 3 words, `900 72px` Anton + Impact (ThumbnailGenerator.mjs:145-146)
- **Secondary:** next 3 words, `700 42px` Inter (ThumbnailGenerator.mjs:153-153)
- **Emphasis:** single word at `900 180px` (ThumbnailGenerator.mjs:159)

Keep these sizes. Never add a 5th+ line if a hook word repeats the title.

**Contrast floor:** white text on dark requires ≥ 10:1; visually this reads as
"white with a dark outline or plate". No gray on gray.

## Rule 3 — Emotion beats logo

A close-up face showing surprise, anger, or concern outperforms neutral
logo-heavy thumbnails. For news, a **live event image** beats a stock
illustration. The logo is present for brand, never the subject.

**Code hook:** cover generator tournaments already test leaked styles
`breaking`, `cinematic`, `minimal`, `reaction`, `data`
(src/index.mjs:469 `generateTournament`). `reaction` is the emotion-biased style
— prefer it when a face is available.

## Rule 4 — Consistency = brand recognition

Keep a fixed style: same font, same logo corner, same color treatment. News
viewers must recognize NEWS-MONSTER even without reading the logo.

Next two hooks already guard this:
- **Pattern jail:** `ThumbnailBrandOptimizer.forbiddenPatterns`
  (src/ai/thumbnail/ThumbnailBrandOptimizer.mjs:28-31) blocks clickbait
  repetition (`"HIDDEN X REVEALED"`, `"SECRET…", "SHOCKING…"`).
- **Learned patterns:** `BrandPerformanceMemory` records which packaging
  patterns have proven low CTR and the optimizer avoids them automatically
  (ThumbnailBrandOptimizer.mjs:152-161, `learnFromAnalytics`).

Keep the logo in the **same corner** on every thumbnail. The generator draws it
once per layout — do not reposition per video.

## Rule 5 — Test in pairs

Create 2–3 variants per video and let the data decide. There is already a
**freshness loop** prefers the best-performing family when CTR difference is
≥ 0.5pp (`ThumbnailIntelligence` baselines clusters). Weekly CTR under 4% → refresh.

---

## Pre-ship checklist

- [ ] Exactly one hero subject visible at phone size
- [ ] 3–5 text words, huge, high-contrast, no full title duplicate
- [ ] Emotion/urgency present (fold no logo)
- [ ] Style tokens unchanged (font, logo corner, color)
- [ ] The 10-foot rule passes (text and subject readable)
- [ ] No forbidden pattern from the optimizer blocklist

## Review cadence

- Every batch (± weekly): recompute `thumbnail_performance` CTR baselines
  (scripts/update-image-performance.mjs reads the same store).
- Pattern at < 4% CTR → refresh thumbnail + let `learnFromAnalytics` mark the
  pattern (ThumbnailBrandOptimizer.mjs:152).