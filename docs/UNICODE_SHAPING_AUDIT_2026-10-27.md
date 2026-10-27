# UNICODE SHAPING AUDIT — Tamil/Sinhala broadcast correctness (task-130)

Date: 2026-10-27 · Scope: NEWS-MONSTER only · Commit: (recorded at ship time)

## 0. Decree & contract honored
Fresh Tamil AND Sinhala end-to-end renders + visual frame inspection are the
completion rule (build/test success alone is insufficient). Every claim below
cites an artifact, a log line, or a test ID. Operator work preserved: selective
commit only (see §8), no reset/clean/force-push.

## 1. Root causes (verified by evidence, not assumption)

| # | Root cause | Evidence | Impact |
|---|---|---|---|
| RC1 | `@napi-rs/canvas` (Skia) does NOT run HarfBuzz shaping — `fillText` draws Indic vowel signs/conjuncts on the wrong side | `src/i18n/ShapedText.mjs` header measurement note (Sinhala කෙ mark after ක; Tamil தே same) | garbled narration captions/headlines |
| RC2 | **Noto Sans Tamil ships WITHOUT Latin letters** (digits + basic punctuation only) — any English brand word ("AI", "youtube") inside a Tamil string rendered `.notdef` tofu | preflight canary: `'AI story'` notdef=true, `'2,500'` notdef=false; mixed canary `ஆங்கிலம்-and-தமிழ்?` notdef=true pre-fix | tofu boxes in Tamil headlines (Noto Sans **Sinhala** bundles full Latin — si unaffected) |
| RC3 | No startup guard tied fonts to renders: a missing/corrupt font file or a font lacking the script reached the RENDER stage as mid-frame exceptions / tofu instead of quarantining the variant | no `FontPreflight` existed pre-task | half-localized videos could publish |
| RC4 | `burnSubtitles` (ffmpeg libass) hardcoded `FontName=Inter`; Inter has no Tamil/Sinhala glyphs — had the subtitle gate ever been enabled for localized variants, burned captions = tofu | `scripts/captions.mjs` force_style pre-edit | latent defect (gate off by default — canvas CaptionLayer is the burned-in authority) |
| RC5 (ruled out) | headless layout metrics were *NOT* a root cause: FontMetrics Tamil ≈ 0.601 em/char vs the 0.6 constant (shaped 1077.6px @64px/28-char sample) — Sinhala headless over-measures (~0.6 vs ~0.5 real, 706.2px @64) which wraps EARLIER = safe direction (no clipping) | probe numbers in §5 | no calibration change made (evidence-driven) |

## 2. The shaping pipeline (verified end-to-end)

```
article.title/description (composer: translated ONCE per variant, cache-first)
  → engine.generateFromArticle: setRenderLanguage(pack) + FONT PRELIGHT (RC3 fix)
  → story translation: headline + per-scene narration + caption.fullText
    (focus cleared for localized — English keyword can't match)
  → TTS (edge-tts ta-LK-SaranyaNeural / si-LK-ThiliniNeural) + timing adaptation
  → headless layout (TextLayoutEngine → FontMetrics grapheme clusters)
  → SceneEngine frames → layers:
      CaptionLayer/CaptionEngine (per-word shaped draw, layout lines honored)
      InformationLayer hero/secondary/retention/explanation-body (shaped re-wrap)
      drawStyledText → drawShaped/measureShaped for all narration callouts
      HeadlineCard, BreakingBanner, ThumbnailOverlay hook, CoverComposer ×6,
      LandscapeComposition (tPack) — all pack-aware
  → audio mix → footer overlay → SRT/VTT sidecars (SubtitleExporter)
  (EN only) libass burn — UNCHANGED; localized variants skip it (RC4 fix)
```

English-by-invariant sites (verified, intentionally untouched): BroadcastUILayer,
BrandingLayer, footer/blocks, IntroEngine brand/slogans, header/status chrome.
Legacy/unused: EmphasisLayer (TextPolicy gate disables focus for localized),
ThumbnailGenerator (no external callers).

## 3. Fixes (smallest-complete set)

| File | Change |
|---|---|
| `src/i18n/ShapedText.mjs` | Script-run splitting: `splitRuns()` (pack-script vs Latin-letter runs; digits/punct/spaces/ZWJ attach to current run) → `shapeText()` composes runs via extracted `shapeOne()`, per-glyph font records `{gid,x,y,rec}`; `drawShaped()` positions each glyph by ITS font's metrics (coherent mixed-script line) and resolves the companion Latin font from the ACTIVE pack (all existing call sites pass `pack.fontFiles` → zero call-site churn); `measureShaped()` same resolution |
| `src/i18n/languages.mjs` | `ta.latinFontFiles = ['assets/fonts/Montserrat-ExtraBold.ttf']` (RC2). si needs none (RC2 evidence) |
| `src/i18n/FontPreflight.mjs` (new) | `assertLanguageFonts(pack)`: font files exist in THIS environment → shape canary corpus (vowel signs, conjuncts ශ්‍ර/ප්‍ර/க்ஷ, digits+native punctuation, mixed script) with ZERO `.notdef` → canvas-registration probe. Throws `RENDER_PREFLIGHT_FAILED` (variant quarantines; nothing half-shaped reaches render). Cache keyed `code‖fontFiles` |
| `src/i18n/FontProbe.mjs` (new) | `DesignSystemFontProbe`: `GlobalFonts.registerFromPath` + `GlobalFonts.has(family)` — proves the binary loads the vendored files & native fallback can resolve the family |
| `src/index.mjs` | engine fail-fast: preflight right after `setRenderLanguage`; `this.currentLangPack` stash; **localized burn skip** in `assembleVideo` (`gates.burnSubtitles` + translated pack → console.info skip; EN path byte-identical behavior) |
| `scripts/composer.mjs` | per-variant preflight BEFORE translation spend — failure quarantines ONLY that variant (`[LANG] variant X quarantined for this run: …` + `continue`), identical contract to translation failure |
| `scripts/captions.mjs` | `burnSubtitles(…, { fontFamily = 'Inter' })` — parameterized (EN unchanged; future Noto/fontsdir burn capability) |
| `src/index.mjs` (sidecars) | **Localized sidecar shipment**: `assembleVideo` writes `captions.srt` + `captions.vtt` for translated packs via the canonical `exportSubtitles` from the LocalizationPipeline, built from the SAME adapted scene windows the render used — the run-4 composer path proved no writer existed (documented contract, now enforced). EN unchanged |
| `src/audio/VoiceSync.mjs` | `LOCALIZE_TTS_RATE` env → edge-tts `--rate` pass-through (e.g. `+15%`), default unset = byte-identical args. Broadcast duration compliance: run-4 evidence — for the SAME article TA chunks summed 41.2s vs SI 28.3s → TA total 46.4s vs the 45s hard cap. Spoken-rate adjustment shortens speech; the TimingAdapter adapts caption windows to ACTUAL chunk durations so speech/captions stay aligned |
| `src/i18n/ShapedText.mjs` (symbols) | Symbol-only native detour: `isSymbolOnly()` (TEXTISH rule — strings containing ANY letter/digit keep the shaped path; pure symbols/punct/spaces go native). `drawShaped`/`measureShaped` detour before any shaping with the EN broadcast family stack `'Montserrat ExtraBold', Inter, sans-serif` (SceneEngine registers the family into GlobalFonts at startup). Root evidence: run-2 SI render printed 3× `[SHAPED] tofu glyphs in "▶…"` — the REPLAY banner's U+25B6 is absent from ALL vendored Noto faces (and `●⚡✦` are absent from every face) while Montserrat carries `▶`/`›` |
| `src/video/layers/EmphasisLayer.mjs` (RC6) | Pack-script emphasis path: `caption_focus` is STORY-DERIVED (localized) but the layer drew it natively with `'Montserrat ExtraBold'` → hollow neon `.notdef` boxes in the reveal-scene glow pulse. **Discovered by the visual frame decree (run-9), invisible to log assertions** (native path emits no hasNotdef warning). Fix: pack-active → sequential `await drawShaped` per line with identical style tokens (accent fill, black 10% stroke, glow via ctx state, translate+scale transform honored); EN native branch byte-identical. Smoke-verified: TA 'மண்டலம்' paints shaped accent ink with 0 warnings; EN native unchanged |

## 4. Font provisioning (reproducible, licensing)

- Fonts were already TRACKED repo assets (committed `daa96f3`):
  `git ls-files assets/fonts` → Anton, Montserrat-ExtraBold, NotoSansTamil{,-Bold},
  NotoSansSinhala{,-Bold}. Docker `COPY . .` ships them; no machine-dependency.
- Licensing: Google's Noto font software is licensed under the SIL Open Font
  License 1.1 (bundled in upstream distribution; OFL permits bundling/
  redistribution with the license text — a `LICENSE` copy accompanies the
  vendored set) — CHECK on disk: see §7.4.
- Startup preflight now FAILS LOUD if the tracked files are missing (RC3).

## 5. Regression evidence (actual commands + counts)

| Command | Result |
|---|---|
| `node --test tests/unicode-shaping.test.mjs` | **24/24 PASS** — preflight pass/missing-file/tofu, notdef detection (Malayalam 'അ', Latin 'A' vs Tamil font), mixed-script split (active-pack default == explicit split == 600.6px; unsplit 547.8px **plus tofu**), symbol detour (`needsShaping('▶')=false`; `drawShaped('▶')` width 50.2px with ZERO tofu warnings; `measureShaped('▶')` == drawn width; 'REPLAY ▶ NEWS-MONSTER' = one Montserrat run, notdef=false, wraps), NFC==NFD, conjunct compaction (க்ஷ 134.5px < 192.3px parts), space preservation (388.5 < 405.2 px), wrapLocalized bounds (ta+si), FontMetrics ratio, parseLangSpec, pack essentials, engine+composer wiring |
| preflight live (3 packs) | `languageFontReport(en|ta|si)` → **all ok:true** (ta mixed canary 723.3px notdef=false; registration "GlobalFonts.has(...)=true" ×2) |
| `node scripts/test-i18n-local.mjs` | **21/21 PASS** (unchanged suite) |
| `node scripts/test-localize-rendered.mjs` | **8/8 guarantees PASS** (real edge-tts + ffmpeg + translation provider chain live) |
| `npm test` (full) | **1514 tests / 1506 pass / 6 fail / 2 skipped** vs baseline 1490/1482/6/2 → **+24 passing (new suite), same 6 pre-existing `architecture`/`landscape-composition` failures (operator work in tree — untouched), no regressions** |

## 6. Fresh end-to-end render evidence (production path, this session)

Run harness: `TEST_PUBLISH=1 QUICK_RENDER=1 node scripts/composer.mjs "<override story>"` (operator-override article → feed skipped; REAL frames, TTS, ffmpeg, publish gates).

| Run | Story | LANGS | Outcome |
|---|---|---|---|
| run-1 | AI Regulation Sweeps Global Tech Giants | en,ta,si | EN: **FULL pipeline COMPLETED** (`output/final.mp4`, 1920×1080 h264, 25.3 MB, frames=277@30fps, DISCOVER→ANALYTICS all stages). ta: quarantined — `SCRIPT_PHRASE_OVERLAP 0.537 > 0.45` (translation cache replay vs prior video). Log killed at 10-min foreground cap mid-SI (operator timeout, not a crash). **Preflight executed and `[SHAPED] tofu` = 0.** |
| run-2 | Samsung Unveils Solar-Powered Foldable Phone | ta,si | **si: FULL pipeline COMPLETED** (`output-si/final.mp4`, 425 frames, all stages). ta: quarantined — `SCRIPT_SIMILAR 0.577 > 0.55` vs a PRIOR-SESSION story ("அமெரிக்க இடைத்தேர்தல்கள்: எலான் மஸ்க்…") in the across-video dedup corpus (voice gate, NOT a font defect). SI exposed the last real defect: **3× `[SHAPED] tofu` on `▶`** (REPLAY banner) → symbol detour shipped (§3) and re-run required → run-3. |
| run-3 | Monsoon Rains Lift Global Rice Harvest Outlook (distinct vocab to clear the voice-dedup corpus) | ta,si | BOTH quarantined pre-TTS: `SCRIPT_SIMILAR 0.737 (ta) / 0.750 (si)` vs a prior-session midterms story → **topic-INDEPENDENT** (see §6.1 — the metric's English-only stop-words + min-denominator overlap make ANY two TA/SI news narrations 0.55-0.75 "similar"). Evidence recorded, metric NOT patched, verification proceeds via the engine's own `ALLOW_DUPLICATE_NARRATION=1` override |
| run-4 | same monsoon story (cache-warm translation) | ta,si | **BOTH FULL PIPELINE REnders COMPLETED** — `output-ta/final.mp4` 21.8MB/46.5s, `output-si/final.mp4` 16.7MB/36.9s 1920×1080 h264+aac@30fps; **`[SHAPED] tofu` = 0** in both renders; preflight OK ×2. UPLOAD/PUBLISH quarantined only on YouTube daily quota (7/6, external platform). TA 46.5s = 1.5s over the rubric's 45s cap: scene-2 Tamil chunk = 13.4s (two-clause desc; others 3.7-5.1s) — adapter correctly extended; orthodox fix = tighter source copy | 
| run-5/6 | Sensex/rate-cut (TIGHT one-clause desc, targeted ≤40s) | ta,si | Both runs quarantined pre-frame: `LANG_TRANSLATE_FAILED … gemini HTTP 429 ×2 + openai-compat 429 ×2` — translation provider rate limits (new article = no cache warmth). The preflight gate behaved exactly as designed (quarantine BEFORE any frame; zero half-localized output). Composer exit semantics noted: per-variant quarantines do NOT change exit code (exit 1 only on fatal) — scheduling observation, not changed here |
| run-7 | same tight story + 8-min provider cooldown | ta,si | 429s PERSIST after cooldown → the limit is a long-window (daily free-tier) quota, not burst rate. Attempt budget for the day spent; cache-warm story is the only provider-independent path |
| run-8 | monsoon story (cache-warm translation replay) + `LOCALIZE_TTS_RATE=+15%` | ta,si | Preflight OK ×2 + translation replay clean (no provider spend) — but **RENDER NEVER RAN**: `ProductionJob` checkpoint-RESUME semantics (same article → same jobId → completed stages skipped, "completed in previous run") picked up run-4's checkpoints whose artifact references had been moved aside → `UPLOAD_REQUIRES_VIDEO`. Discovered a resume-vs-artifact-hygiene interaction; checkpoints (pipeline-resume state, NOT dedup stores) for MY task articles set aside so the next run re-renders with final code |
| run-9 | monsoon story, fresh checkpoints + `LOCALIZE_TTS_RATE=+15%` | ta,si | **DEFINITIVE**: preflight OK ×2; translation replay clean (no 429); `[TIMING-ADAPT] ta plan 31.7s → adapted 42.796s (7 chunks) / si → 35.576s`; `[SUBTITLES] localized sidecars: captions.srt + captions.vtt (7 clips, TA 40.096s / SI 32.876s)` ×2; both `[RENDER] video produced` → `output-ta/final.mp4` (19.77MB/**43.5s** ✓ <45s) + `output-si/final.mp4` (16.91MB/**36.5s**); both `RENDER: COMPLETED`; **`[SHAPED] tofu` = 0** across the whole run. UPLOAD-only quarantine = YouTube daily quota (external; artifacts valid). QA harness `output-qa-evidence-task130/`: 12 frames @1920px all ink-sane (TA 3.6–9.2%, SI 3.9–8.1%); sidecars: TA `{tamil:true, latin:true, hasSeparatedVirama:true, tofuBoxes:0, firstCue 00:00:00,000, 7 cues, vtt:true}`; SI `{sinhala:true, hasSeparatedVirama:true, tofuBoxes:0, firstCue 00:00:00,000, 7 cues, vtt:true}`; logAssertions {tofu=0, preflightOk=2, renderCompleted=2, renderQuarantined=0, sidecarLines=2, translation429_run9=false}. **VISUAL DECREE (12 PNGs read by eyes)**: TA + SI caption/headline glyphs shaped correctly (conjuncts/vowel signs/pulli/ais-pilla/komaedi attached, zero boxes; TA cue contains 'eight percent' Latin inside Tamil → mixed-script run-split live in artifact; SI keeps 'WHY IT MATTERS' EN kicker — composition invariant ✓). **FOUND RC6**: SI frame ~25s + TA frame ~32s show the reveal-scene emphasis keyword as 5/8 hollow neon boxes → `EmphasisLayer` native `ctx.font=Montserrat` on story-derived `caption_focus` → fixed (§3 RC6 row) → regression tests added (26/26) → fresh render = run-10 |
| run-10 | same monsoon story, RC6-fixed code, run-9 checkpoints set aside, `LOCALIZE_TTS_RATE=+15%` | ta,si | **FINAL, ALL GREEN**: preflight OK ×2 (Noto Tamil/Sinhala canaries); translation replay clean; `[TIMING-ADAPT] ta plan 31.7s → adapted 42.796s / si → 35.576s (7 chunks each)`; `[SUBTITLES]` sidecars ×2 (TA 40.096s / SI 32.876s, 7 cues, firstCue 00:00:00,000, `captions.vtt` true); `[RENDER] video produced` ×2 → `output-ta/final.mp4` (19696152 B/**43.5s** ✓) + `output-si/final.mp4` (16522040 B/**36.5s**), 1920×1080 h264 High 30fps + aac 96k stereo; `RENDER: COMPLETED` ×2, `RENDER: QUARANTINED` = 0; **`[SHAPED] tofu` = 0**. logAssertions (patched to run-10 refs): {shapedTofu=0, preflightOk=2, renderCompleted=2, renderQuarantined=0, sidecarLines=2, preflightFailed=false, translation429=false}; UPLOAD quarantined ×2 = YouTube daily quota only. QA `output-qa-evidence-task130/audit-summary.json`: **18 frames** (9/variant, 0.06→0.90 incl. reveal band 0.68–0.74), ink 1.6–9.2% (low boundaries = dark imagery, eyes-checked), sidecar script probes `{tamil/sinhala:true, tofuBoxes:0, hasSeparatedVirama:true}`; accent-blob tripwire calibrated on run-9 positive control (FIRED: fused 1–2 big blobs) then run-10 reveal band comp=5–12/big=4–6 (ambiguous between fused glow — resolved by decree below). **VISUAL DECREE run-10 (13 PNGs + 2 reference renders read by eyes)**: reveal emphasis keywords now **SHAPED** — TA = **பருவமழை** (ப bar+triangle, ரு inner-curl, வ bowl, ம double-hook, ழ+vowel cluster: cluster-for-cluster match with a drawShaped reference render of the same word), SI = **මෝසම්** (spiral/hook clusters match its reference render); run-9's 5/8 uniform hollow boxes GONE. Standard sweep re-verified post-RC6: TA caption (cue-2 text with ண்ட/த்தி conjuncts, ா ை ு vowel tails, pulli), SI headline (ජාත්‍යන්තර yansaka stack, ප්‍ර rakaransaka, komaedi circles), SI 'WHY IT MATTERS' EN kicker invariant, ▶/› Subscribe arrow native, outros (STAY WITH / NEWS-MONSTER / UNFILTERED NEWS FROM THE FUTURE) clean. **Task completion decree satisfied: fresh Tamil AND Sinhala full-pipeline outputs, end-to-end, visually frame-verified shaped with zero tofu.** |

Both quarantine causes are the voice-dedup gates doing their job on translation-cache/corpus overlap — operational, not font/code defects; remedy per attempt = distinct-topic story; dedup stores never modified.

### 6.1 Discovered defect: across-video narration similarity is script-blind (evidence, not patched)

Three maximally-distinct-topic stories hit the same gate with INVERTED scores —
topical distance does not move the metric:

| Story | vs corpus top-match | Score | Threshold | Verdict |
|---|---|---|---|---|
| AI Regulation (ta) | midterms/Elon-Musk story | phrase-overlap 0.537 | 0.45 | quarantine (run-1) |
| Samsung Solar (ta) | same | SCRIPT_SIMILAR 0.577 | 0.55 | quarantine (run-2) |
| Monsoon/Rice (ta) | same | SCRIPT_SIMILAR **0.737** | 0.55 | quarantine (run-3) |
| Monsoon/Rice (si) | same | SCRIPT_SIMILAR **0.750** | 0.55 | quarantine (run-3) |

A monsoon/agriculture story scores HIGHER against a midterms story than a
semiconductor-policy story did → the dominant term is structural/function-word
overlap, not content. Mechanism (`src/uniqueness/ScriptUniqueness.mjs`):
`_weighted()` = intersection / **min(tokenA, tokenB)** (overlap coefficient,
min-dominated when corpus texts are short) + `STOP_WORDS` is an **English-only
list** (L379+) while the system now narrates in Tamil/Sinhala — their function
words (இன்று/ஒரு/மற்றும் … , මෙම/සහ/ලෙස …) all count as "significant tokens",
so ANY two localized news narrations share 0.5–0.75 of tokens structurally.
Latent before the tri-lingual rollout (EN stop words implicitly matched EN-only
narrations); at 48/day localized publishing every Tamil/Sinhala script will
systematically trip every previous one.

**Not patched in this task** (production hard gate owned elsewhere; weakening /
editing it exceeds the Unicode-rendering charter and endangers its test suite).
Remedy used for verification completion: the engine's OWN designed override
`ALLOW_DUPLICATE_NARRATION=1` (child env of the `!== '1'` guard at
`src/index.mjs:803`) — dedup-VALIDATE only is skipped; `record()` still runs
(corpus accretion unaffected; no stores touched). Recommendation for the owner:
script-aware stop words (TA/SI function lists) + a length-balanced denominator
(mean or max instead of min) + optionally per-script bigram weighting.

## 7. E2E findings

7.1 EN run-1: full pipeline COMPLETED (DISCOVER…ANALYTICS), `output/final.mp4` 1920×1080 h264, 25313665 B, [RENDER] frames=277 @30fps — see §7 JSON + PNGs.

7.2 `[SHAPED] tofu` warning lines: run-1 EN = 0; run-2 = **3 (all the REPLAY banner ▶, SI render — now root-caused & fixed)**; run-3 → run-10 = **0** (asserted by the QA harness log scans). **System lesson (run-9/10)**: log-level tofu assertions cannot see a NATIVE draw call that escapes the shaped engine — the EmphasisLayer notdef boxes were found only by the frame decree. Visual verification is the completion canon, not optional.

7.3 Voices: ta-LK-SaranyaNeural / si-LK-ThiliniNeural as configured; provider chain live.

7.4 Font license on disk: **`assets/fonts/LICENSE-OFL.txt`** (SIL OFL 1.1 full text + per-file attribution for Noto Tamil/Sinhala/Montserrat/Anton + bundling/RFN compliance notes). Added this session — the vendored set previously shipped without a license file (compliance gap closed).

## 8. Operator-work preservation & commit method

- Operator's OAuth hunks live in `packages/dashboard/index.mjs` (decoded by line
  scopes: 1255/3426/3436/3958/3968 + oauthState import) — UNCOMMITTED, guarded.
- `src/index.mjs` diff vs HEAD = **only my hunks** (+16/−1 after §3 hooks).
- Commit via clean temp worktree at HEAD → re-apply identical edits → branch
  from origin/main → cherry-pick → FF push (same method proven in task-129,
  commit c708923).

## 9. Operational observations (evidence, not code changes)

- **Composer exit semantics**: per-variant quarantines (preflight, translation
  429s, voice-gate, upload-quota) do NOT change the process exit code; exit 1
  only on fatal exceptions. A run where EVERY variant quarantines still prints
  "Pipeline Complete" and exits 0 (observed run-5/6). Scheduling/monitoring
  should key on the `[JOB] …` stage lines, not the exit code. (Out of the
  Unicode charter — recorded, not changed.)
- **Translation provider rate limits**: cache-cold stories require live
  provider batch calls; a 429 burst across all channels quarantines the
  variant before any frame is drawn (by design). Cache-warm reruns bypass the
  spend entirely (cache-first translation), which is what runs 3/4 leveraged.
- **YouTube upload quota** (7/6 daily) quarantined UPLOAD/PUBLISH downstream of
  the final artifact in run-4 — platform-side, unrelated to rendering.
- **`edge-tts` CLI absent, `python3 -m edge_tts` fallback works** — the
  VoiceSync dual-invocation path is what makes the rate pass-through usable.
