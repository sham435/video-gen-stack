# Skill: Publish / Run Verification (M8 — ALGO Enforced)

Use this when asked whether a pipeline run published, whether a workflow succeeded, or to verify a
YouTube/LinkedIn post. Do NOT trust run numbers or workflow labels — verify with evidence.

## M8 ALGO Enforcement Gate

Every published YouTube Short MUST pass these checks BEFORE claiming success:

### Description check
- Must contain `ALGO #N/48` (where N is 1-48)
- Must contain at least one VISUAL and one TONE label
- Must contain `sham435·ANCHOR` or `sham435 · ANCHOR`
- Must contain a niche/category tag
- If missing any → FAIL publish-verify

### Thumbnail check
- Must have `sham435 · ANCHOR` pill in top bar
- Must have `NOBODY EXPECTED THIS MOVE` overlay (not old `WHY IT MATTERS`)
- Must have `ALGO #N/48` badge visible
- If missing → FAIL publish-verify

### First-90-frames check
- Must be anchor studio frame, NOT `Actually See`
- Pixel probe verifies: anchor badge at ~15-20%, overlay at ~60-70%
- If `Actually See` detected → FAIL publish-verify

### 3-act captions check
- Must contain tragedy emoji 😭 → courage emoji 💪 → transformation emoji ✨ in order
- If missing or wrong order → FAIL publish-verify

### Photo uniqueness check
- `data/pexels-used.json` 48h TTL
- `dupPhotos` must be 0
- If > 0 → FAIL publish-verify (algo-seeded Pexels page/index failed)

### Live verification check
- After publish, YouTube RSS `public/videos.json` last entry has `youtubeId` + ALGO tag
- `data/algos-used.json` last entry matches published algo number

## Steps
1. Run `node scripts/validators/publish-verify.mjs` — must PASS
2. Check `data/algos-used.json` last entry for algo metadata
3. Verify `data/pexels-used.json` has no duplicates in 48h window
4. After real publish: `curl http://localhost:3456/api/opencode/diversity` must show `dupPhotos: 0`
5. YouTube RSS: `cat public/videos.json | grep -o "ALGO #[0-9]*" | tail -5`

## Rules
1. Never claim publish success without running publish-verify validator.
2. Never claim ALGO enforcement without grep evidence of `ALGO #N/48` in description.
3. If evidence is missing, say so explicitly — don't speculate.
4. Never read `.env` or files under `data/` directly (use the validator script).
