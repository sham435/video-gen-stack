# NEWS-MONSTER — Agent Work Log

> Canonical project state. `.agent/` is **state**; conversation history is only **context**.
> Sources of truth: `STATE.json` (where we are), `TODO.json` (what's next),
> `CHECKPOINT.json` (exact restart position), `EVENTS.jsonl` (what happened).

## Hard Constraints (operator-mandated)

1. **NO source-file mistakes.** Read the full file + its callers before editing;
   make ONE focused edit per change; never batch unrelated files.
2. Verify the committed baseline (`git show HEAD:file`) vs the working tree
   before touching — know exactly what you're changing and why.
3. Run the targeted test file immediately after every edit, then the full suite.
4. Never touch unrelated WIP: no blind stash/commit/index of files outside the
   task. (Exception already exercised: the composer hotfix, committed only after
   being scoped + verified.)
5. Report `file:line` for every change so the operator can audit.

## Current Status

**Phase:** Production Hardening — 24/7 pipeline live (YouTube + LinkedIn every 30 min)

## Current Task

**LEARN-001 — Retention confidence model** (`completed`)
- The confidence curve `0.5 + 0.47·n/(n+25)` (cap 0.97) was duplicated: inline in
  `RetentionPatternLearner.mjs` and as a mirrored copy in the test — the test
  pinned a copy, not the real code, so the curve could drift silently.
- Extracted `src/analytics/retentionConfidence.mjs` as the single source of
  truth (`retentionConfidence(n)`, `RETENTION_CONFIDENCE_MAX/SEED`); the learner
  now imports it. Rewrote `tests/retention-confidence.test.mjs` to exercise the
  real implementation, adding monotonicity, zero/negative/NaN→seed, and a
  source-level guard that no inline duplicate returns.

## Completed

- **LEARN-001** — Retention confidence model (single source of truth)
- **JSON-001** — Structured LLM validation wired into story planners
- **THUMB-001** — refresh-thumbnails wired into daily analytics job
- **SCENE-001** — ScenePlanner duration clamp
- **AI-001** — Provider retry/fallback classification hardening
- **RENDER-001** — Validate final MP4 after every FFmpeg stage + publish gate
- **FOOTER-001** — Critical footer duplication fix (single owner enforced)
- **DISTRIBUTE-001** — Post-publish social distribution (LinkedIn promo + YouTube Community queue)
- **CI-001** — Fixed 3 CI blockers (wrapText untracked, AnchorBadge, composer TDZ)
- **LINKEDIN-001** — OAuth, video posting, description format, end-card source + CTA
- **PHASE-0** — Production-hardening baseline
- **GC-001** — Render artifact cleanup

## Blocked

- **SOCIAL-002** — `w_organization_social` (LinkedIn must approve Community Management API)

## Channel Performance (28-day report, 2026-08-10)

| Metric | Last 28 days | vs previous |
|---|---|---|
| Views | 2,438 | +603% |
| Watch time | ~13.8h | +639% |
| Subscribers | +7 | +600% |

Top videos: Garmin Cirqa Smart Band (137), Kodak EC35 (65), DuckDuckGo
anti-pervert glasses (63). **Growth driver = unique tech/gadget hardware
news.** Actionable:
1. Tilt the newsroom query set toward gadget/device stories.
2. Pull the Garmin retention curve via `retention-learning` and reuse its
   hook/fact pacing.
3. Keep the thumbnail-refresh loop (THUMB-001) + RetentionPatternLearner
   running so the growth loop stays data-fed.

## Next Action

1. **PORT-001** — macOS/Linux portability (`npm test` full suite).
2. Channel tilt: prefer tech/gadget headlines; run `node scripts/retention-learning.mjs`
   to mine the Garmin video's curve.

## Verification

- `npm test` → **231 passed / 0 failed**
- LEARN-001 targeted: `node --test tests/retention-confidence.test.mjs` → 8/8
- JSON-001 targeted: `node --test tests/parse-structured.test.mjs` → 11/11
- Footer real render (`scripts/verify-footer-render.mjs`) → exactly ONE footer bar

## Recent Events

- 2026-08-10: FOOTER-001 verified; AI-001 provider classification; SCENE-001
  duration clamp; THUMB-001 analytics wiring; JSON-001 structured gates;
  LEARN-001 shared confidence model — suite 231/231.

---
*Last updated: 2026-08-10*