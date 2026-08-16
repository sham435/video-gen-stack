# Skill: 48-Algorithm Diversity Engine

Use this when working with cover/concept diversity, algorithm selection, or visual-style rotation.

## Key facts
- Core: `src/ai/StoryAlgorithmRegistry.mjs` — 6 axes, 48 combos.
- Deterministic selection: `pickAlgorithm({ title, category })` = title hash + category bias.
- Shared entry point: `src/visual/BrandStyleResolver.mjs` `resolve()` returns `algorithm` +
  algorithm-shifted `brandColor` + `anchorHook`.
- Main pipeline: `src/video-studio/CoverDirector.mjs` (`_deterministic`) + `CoverGenerator.mjs`
  (`resolveHero`/`searchPexels` use `algorithm.seed` for Pexels page + index).

## The 6 axes
| Axis | Count | Options |
|------|-------|---------|
| HOOK | 8 | NOBODY_EXPECTED, LOST_IN_RAIN, BULLIED, FELL_IN_RIVER, BROKEN_TOY, LEFT_BEHIND, HUNGRY_STOLE, SHOCKING_NUMBER |
| ARC | 6 | RAIN_SHELTER_LOVE, HUNGER_SHARE_HERO, BULLY_STUDY_SUCCESS, RIVER_SAVE_FISH, BROKEN_FIX_INSPIRE, LEFT_RUN_REUNION |
| VISUAL_STYLE | 8 | STUDIO_NOIR, RAIN_CINEMA, GOLDEN_HOUR_HERO, HANDHELD_DOC, MINIMAL_WHITE, NEON_CYBER, NATURE_MACRO, VILLAGE_WARM |
| TONE | 6 | ANCHOR_BREAKING, ANCHOR_EMPATHY, ANCHOR_ROAST, ANCHOR_INSPIRE, ANCHOR_DETECTIVE, ANCHOR_KID |
| STRUCTURE | 4 | HOOK_PROBLEM_COURAGE_WIN, COLD_OPEN_FLASHBACK, MYSTERY_REVEAL, FAST_CUTS_6 |

5 axes above are enumerated → 8 × 6 × 8 × 6 × 4 = **48** (combined with arc-derived visuals = 48 unique IDs).

## Deterministic selection
- `algoId = hook_arc_visual_tone_structure`, `algoNumber = hash % 48 + 1`.
- Category bias: `politics`/`business` → NOBODY_EXPECTED; `technology`+`ai` → SHOCKING_NUMBER.

## Where the algorithm must surface
1. Cover overlay: ALGO badge `#N/48 • {visual} • {tone}` (renderer top bar) + `ALGO {N}/48` in bottom bar.
2. Metadata.json: `algoNumber` 1-48, `algoId`.
3. Pexels: page = `seed % 10 + 1`, index = `(seed + algoN * 7) % len` → no two stories share a photo.
4. PromptEngine `anchorStoryPrompt`/`arcScenes` and StoryDirector prompt must include `algo.id`.

## Rules
1. Never reuse the same photo for two different stories (48h exclusion via `pickDistinctPhoto`).
2. `pickAlgorithm` must stay deterministic — same title+category → same algorithm.
3. Never read `.env` or files under `data/`.
