# Skill: NEWS-MONSTER 3-Act Story Arc

Use this when writing, reviewing, or editing the anchor narrative formula for videos.

## Key facts
- Every video follows a 3-act arc driven by the anchor voice `sham435 · ANCHOR` (`NEWS-MONSTER`).
- Core: `src/ai/StoryDirector.mjs` (system prompt + `fallbackPlan`) and `src/ai/PromptEngine.mjs`
  (`anchorStoryPrompt()`, `arcScenes()`).
- Algorithm (visual/tone/structure) comes from `src/ai/StoryAlgorithmRegistry.mjs` via `pickAlgorithm()`.

## The 3 acts
| Act | Label | Time | Emoji | Story | Visual |
|-----|-------|------|-------|-------|--------|
| 1 | PROBLEM / THE TRAGEDY | 0-8s | 😭 | Establish the victim + unfair world | rain on glass, grainy newsroom, empty street, worried face |
| 2 | COURAGE / SACRIFICE | 8-18s | 💪 | Hero fights the machine: building/sharing/studying | hands working, night desk lamp, small wins |
| 3 | TRANSFORMATION | 18-25s | ✨ | The world notices; family love + celebration | embrace, golden hour, applause |

- Total: 25s (8/10/7) for youtube_shorts.
- Anchor hook: `Nobody expected this move — {title}`.
- Always end with moral: `This is the power of never giving up.`
- Source attribution is mentioned once in Act 3 (never in the outro card).

## Monkey-empathy mapping (algorithm arc → human archetype)
| Arc | Archetype | Goal |
|-----|-----------|------|
| rain_shelter_love | lonely founder | builds a shelter from the storm |
| hunger_share_hero | underdog creator | builds something the world needs |
| bully_study_success | bullied innovator | studies harder, proves bullies wrong |
| river_save_fish | desperate startup | swims against the current |
| broken_fix_inspire | broken dreamer | fixes what the giants broke |
| left_run_reunion | abandoned worker | runs until finally seen |

## Rules
1. Never let article words leak into the close/outro scene (fixed brand outro enforced by
   `applyBrandOutro`).
2. Act 1 must open with the hook in the first 3 seconds.
3. Every `scenePlan` must pass through `validate()` (duration 2-8s, total 15-60s).
4. Never read `.env` or files under `data/`.
