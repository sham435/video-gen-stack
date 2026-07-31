# OpenCode Self-Modification Standard

## Purpose
Defines the hardened, 10-safeguard process for AI agents modifying the OpenCode Engine's own configuration, personas, memory, workflows, policies, and integration code. Eliminates the common failure modes of: stale file references, hallucinated formats, broken registry entries, orphaned files, large unreviewable diffs, and missing rollback.

## When to Use This Workflow
Every prompt that modifies ANY of the following MUST follow this standard:
- `.opencode/system-config.json` (registry + schema)
- `.opencode/agents/*.md` (personas)
- `.opencode/memory/*.md` (knowledge base)
- `.opencode/workflows/*.md` (process docs — including this file)
- `.opencode/policies/*.md` (governance rules)
- `src/integration/OpenCodeBridge.mjs` (the reader / schema enforcer)
- `packages/dashboard/routes/opencode.mjs` (dashboard API)
- `.github/workflows/opencode-*.yml` (CI integration)

If your change touches one file from the list above, assume it depends on others and run the full workflow.

---

## The 12 Safeguards (non-negotiable)

Every self-modification prompt MUST include each of these, either as explicit instructions or via automation in `OpenCodeBridge` + `scripts/opencode-validate.mjs`.

### Safeguard 1 — Repository Discovery First

**Prompt requirement**: Start with a "Phase 0" block that verifies every target file exists at the quoted path.

```
Phase 0 — Discovery
-------------------
For every file listed in TARGET FILE(S):
  - Verify the file exists at the EXACT path given (do NOT resolve wildcards)
  - If missing:
      * search the entire repo for likely replacements (basename match + content fingerprint)
      * report discrepancy in final report under "Discovery Anomalies"
      * adapt the change plan; DO NOT silently fall back to an invented path
  - If present: record size, last-modified, and first 3 non-empty lines as a fingerprint
Rule: Never create a file because it "should exist." Report absence first.
```

**Bridge enforcement**: Partial — `runDiagnostics().integrity.brokenRegistry` catches stale entries; new files must be verified by the agent in prompt text.

### Safeguard 2 — Preserve Backward Compatibility

**Prompt requirement**: For any schema / API change, explicitly confirm existing keys survive.

```
Backward Compatibility Rule
----------------------------
Do NOT remove or rename existing top-level keys, existing getSystemContext() fields,
or existing OpenCodeBridge public methods UNLESS the task explicitly requests a break.
If a rename is required, you MUST:
  (a) keep the old key functional as an alias or shim for at least 2 revision cycles,
  (b) add a schemaWarning under "deprecated" listing the old name + sunset plan,
  (c) migrate ALL internal references in the same commit (bridge + dashboard + tests).
```

**Bridge enforcement**: `REQUIRED_TOP_LEVEL_KEYS` is hard-coded. Removing one causes constructor failure before any API can be called. `getSystemContext()` must return its historical 6 keys; validators will catch accidental drops.

### Safeguard 3 — Minimal Diffs Only

**Prompt requirement**: State the allowed diff size policy.

```
Minimal Diff Rule
-----------------
Modify the smallest set of lines that satisfies CHANGE SPEC.
Rules:
  - Do NOT reformat unrelated lines (no "I also cleaned up whitespace").
  - Do NOT rename variables, reorder methods, or re-sort JSON keys unless CHANGE SPEC requires it.
  - Preserve existing comments and ordering. If a new entry MUST be added, place it:
      * in JSON: after existing siblings, preserving alphabetical order where that is the convention
      * in .md files: at the end of the applicable section
  - Max target diff: 40 lines changed per file for Review-level tasks. Approve-level tasks may exceed with a one-line justification per file in the final report.
```

**Bridge enforcement**: N/A — human review gate. Include diff stats in final report summary so reviewer can enforce.

### Safeguard 4 — Rollback Plan + Snapshot

**Prompt requirement**: Take a restorable snapshot BEFORE any edits.

```
Rollback Rule
-------------
Before modifying any target file:
  1. Call: const snap = (new OpenCodeBridge()).snapshotForRollback([...list of target files...])
     — or run the equivalent code path via node -e if outside a module context
  2. Store snap.snapshotTakenAt in your report.
  3. If ANY validation step in Phase 4-6 fails:
       - execute snap.restore() immediately,
       - record restore() return value in "Rollback" section of final report,
       - STOP. Do not attempt to fix the broken state on top of the failed edit.
  4. If all validations pass: keep snapshot metadata in report; do NOT restore.
```

**Bridge enforcement**: `OpenCodeBridge.snapshotForRollback(targetFiles)` at lines 346-403 of OpenCodeBridge.mjs. Returns `{ snapshotTakenAt, files, restore }`. Rollback logs append to `.opencode/rollback-log.jsonl`.

### Safeguard 5 — Schema Validation Beyond JSON Syntax

**Prompt requirement**: Replace the naive "JSON.parse succeeds" with the bridge's built-in schema validator.

```
Schema Validation Rule
-----------------------
Instead of only JSON.parse() / node --check, you MUST run:
  1. JSON syntax check (still required — baseline)
  2. OpenCodeBridge constructor check: node -e "import('./src/integration/OpenCodeBridge.mjs').then(m=>{const b=new m.OpenCodeBridge(); console.log('constructor OK, schemaWarnings:', b.schemaWarnings)})"
     — the constructor itself validates REQUIRED_TOP_LEVEL_KEYS + types. If it throws, the config is broken.
  3. validateIntegrity() summary: report schemaErrors count (must be 0), schemaWarnings list.
Expected top-level keys that MUST exist: agents, memory, workflows, policies, approval_required, data_sources, integration_points
Allowed metadata keys that may exist: engine, description, version
```

**Bridge enforcement**: `validateConfigSchema()` in OpenCodeBridge.mjs lines 41-111. Constructor throws on any `schemaErrors`. Warnings pass through but are reported.

### Safeguard 6 — Verify Every Registry Entry (Not Just One)

**Prompt requirement**: Replace "load the first agent as a smoke test".

```
Full Registry Sweep Rule
-------------------------
Instead of loading only the first/modified entry:
  - loadAllAgents() — EVERY registered agent must load from disk
  - loadAllMemory() — EVERY registered memory entry must load
  - loadAllWorkflows() — EVERY registered workflow (including this one) must load
  - loadAllPolicies() — EVERY registered policy must load
Short form: node -e "import('./src/integration/OpenCodeBridge.mjs').then(m=>{const b=new m.OpenCodeBridge(); const r=b.validateIntegrity(); console.log(JSON.stringify(r.registrySweep, null, 2)); console.log('sweep ok:', !Object.values(r.registrySweep).flat().some(x=>!x.ok))})"
Any single failure => treat the whole task as failed => trigger Safeguard 4 rollback.
```

**Bridge enforcement**: Methods on OpenCodeBridge at lines 270-316. `validateIntegrity()` aggregates them all and computes `ok: false` if any entry fails.

### Safeguard 7 — Detect Orphaned Files and Broken Registry Links

**Prompt requirement**: Bidirectional check — "every registered file exists, every .md in the known directories is registered."

```
Orphan + Broken Registry Rule
------------------------------
Run validateIntegrity() and inspect BOTH:
  (a) brokenRegistry[] — entries in system-config.json whose path does not exist on disk
  (b) orphanedFiles[] — .md files under .opencode/{agents,memory,workflows,policies}/ that are NOT registered
Expected result for both: empty array []
If orphanedFiles is non-empty, you MUST either:
  - register the file (add the appropriate entry to the matching config key), OR
  - in the final report, under "Orphan Review", explain why it is intentionally unregistered (e.g., WIP draft, deprecated copy). Do not silently leave orphans.
If brokenRegistry is non-empty: treat as failure and roll back (S4). There is no "intentional broken link" exception.
```

**Bridge enforcement**: `detectOrphans(parsed)` at lines 113-154 of OpenCodeBridge.mjs. Runs both directions.

### Safeguard 8 — Idempotency Check

**Prompt requirement**: Run the modification logic twice, confirm second run is a no-op at the diff level.

```
Idempotency Rule
----------------
After all validations pass (Phase 6 clean):
  1. Take a content hash of every modified file AFTER the first application.
  2. Re-apply the EXACT same change sequence to the already-modified files.
     (If the change is described as a prompt instruction, re-run the prompting logic against the post-change state.)
  3. Re-hash each file.
Pass condition: every file hash is byte-identical between step 1 and step 3.
Shortcut for simple edits:
  - For system-config.json: construct a NEW bridge BEFORE and AFTER the idempotency re-run; confirm b.isConfigSameAs(otherConfig) returns true
  - For .md / code files: git diff --no-index <file> <file_copy_before_idempotency> must be empty
Failure: if hashes differ, your change is not idempotent. Fix the re-apply logic or justify in Remaining Risks.
```

**Bridge enforcement**: `_computeSignature(obj)` + `isConfigSameAs(otherConfig)` at lines 169-184. Provides stable hash for config-structural idempotency (not byte-for-byte, but order-insensitive structural).

### Safeguard 9 — Explicitly Prohibit Fabricated Paths

**Prompt requirement**: Reinforce Safeguard 1 with a hard "never invent" rule.

```
Fabricated Paths Prohibition
-----------------------------
Never create a file at some location because it "seems right" or "matches the pattern."
Procedure:
  - Path in CHANGE SPEC exists  → use it (after Phase 0 verification).
  - Path in CHANGE SPEC does NOT exist  → search for alternatives; report; only create if the TASK explicitly says "create new file at PATH" AND no similar file exists.
  - If creating a new file, you MUST register it in the matching config key in the SAME commit (avoids Safeguard 7 orphan flag).
Examples of violations:
  - "I noticed agent/security.md was missing, so I created it" — violation unless task requested that specific file
  - "I updated the config to point to agents/newagent.md (I didn't create the file)" — violation; creates brokenRegistry entry
```

### Safeguard 10 — Standardized Final Report

**Prompt requirement**: Agent must end with EXACTLY this format. Do not paraphrase sections. Do not omit sections.

```
OpenCode Self-Modification Report
==================================

Files Modified (path: lines changed / diff size):
  - <path>: <stat>

Files Created (if any):
  - <path>: <reason>

Files Renamed (if any):
  - <old> → <new>: <reason>

Registry Updated (entries added/removed/renamed per config key):
  agents:  <+n / -n / renamed: a→b>
  memory:  <+n / -n / ...>
  workflows: <...>
  policies: <...>
  approval_required: <+n / -n>
  data_sources: <+n / -n>
  integration_points: <+n / -n>

Schema Validation:
  schemaErrors: <count — MUST be 0>
  schemaWarnings: <list each, or "none">

Full Registry Sweep (pass / fail + counts):
  agents: <pass/fail> — <ok>/<total>
  memory: <pass/fail> — <ok>/<total>
  workflows: <pass/fail> — <ok>/<total>
  policies: <pass/fail> — <ok>/<total>

Broken Registry Links: <count — MUST be 0, or list each>
Orphaned .md Files:   <count — MUST be 0 OR each one explained under Orphan Review>

Orphan Review (if orphans non-empty):
  - <path>: <reason intentionally unregistered>

Rollback Snapshot: taken at <ISO timestamp from snapshotForRollback()>
Rollback Required: <Yes / No>
  - If Yes: attach the restore() report array.

Idempotency Check: <Pass / Fail>
  - Evidence: <e.g., config signatures identical before/after re-run>

Validation Passed: <Yes / No — aggregate of S5-S7 + syntax + import resolution>

Smoke Tests Passed: <Yes / No — list each smoke test run + result>

Approval Level Rationale: <Auto/Review/Approve/Controlled — cite ai-approval.md lines>

Remaining Risks (if any):
  - <item + mitigation idea>

Discovery Anomalies (from Phase 0, if any):
  - <target-file>: <moved to X / missing / size mismatch>
```

---

## Generalized 9-Phase Workflow

Use this exact sequence in every self-mod task.

```
Phase -1 — Dry-Run Planned Diff
  □ Using CHANGE SPEC + pre-edit file contents, construct the full planned change set BEFORE any disk write
  □ Produce "Planned changes" block listing Modify / Create / Delete / Rename for every file affected
  □ Count estimated changed lines (+added, -removed) per file; attach totals
  □ If Approve/Controlled level: present planned diff to human BEFORE Phase 0 write-access starts
  □ Optional approval gate: STOP here until human reacts to the planned diff
  □ Save the planned diff object; compare against actual applied diff later (Phase 7 report)

Phase 0 — Repository Discovery
  □ Verify each target file exists; record fingerprints
  □ Search for replacements for any missing path
  □ List discovery anomalies for final report

Phase 1 — Read Existing Implementation
  □ Read every target file in FULL (no partial reads for edits)
  □ Read sibling reference files to match style (e.g., when adding an agent, re-read engineering.md)
  □ Note: "Read" means Read tool / cat; do NOT rely on memory of past context

Phase 2 — Prepare Minimal Change Plan
  □ Write bullet list: "File X: lines Y-Z change to <new snippet>"
  □ Confirm no existing keys / methods / fields are to be removed (S2)
  □ Take rollback snapshot BEFORE any write (S4)

Phase 3 — Apply Edits
  □ Apply smallest diffs per plan (S3)
  □ For new .md files under known dirs: REGISTER IN CONFIG IN SAME COMMIT (S7 + S9)
  □ For registry entries added: confirm target file exists (S7)

Phase 4 — Schema Validation
  □ JSON.parse for .json files
  □ node --check for all .mjs / .js touched
  □ OpenCodeBridge constructor → no throw; record schemaWarnings (S5)
  □ validateIntegrity().schemaErrors === 0
  □ Run: node scripts/opencode-validate.mjs --schema-only

Phase 5 — Bridge + API Smoke Tests
  □ getSystemContext() returns historical 6 keys (S2)
  □ getApprovalLevel('push-to-main') === 'controlled'
  □ getAgentNames() count matches config count
  □ Dashboard import resolution: node -e "import('./packages/dashboard/routes/opencode.mjs')" succeeds
  □ Dependency-Graph Chain validation: for every registry entry, walk the full chain:
       system-config.json entry → registered path exists → file parses → loadAgent/loadX() succeeds → API endpoint exposes
  □ Run: node scripts/opencode-validate.mjs --smoke

Phase 6 — Registry Integrity Checks
  □ Full sweep: loadAllAgents/Memory/Workflows/Policies — all pass (S6)
  □ brokenRegistry empty (S7)
  □ orphanedFiles empty OR each explained (S7)
  □ Idempotency re-apply + signature check passes (S8)
  □ Run: node scripts/opencode-validate.mjs --registry

Phase 7 — Produce Change Report
  □ Fill in Safeguard 10 Standard Report IN FULL
  □ Attach restore() reports if rollback happened
  □ Attach Phase -1 planned diff vs actual applied diff delta
  □ Run: node scripts/opencode-validate.mjs --all  → exit 0 means Phase 7 gates met

Phase 8 — Rollback on Failure (auto)
  □ If any check in Phases 4-6 fails: call restore(), log report, STOP (S4)
  □ Never try to "fix after broken edit" on a live tree; restore first, then re-plan
  □ Rollback eligibility: snapshot must be < 30 minutes old and ALL files in snapshot still match pre-edit fingerprints
```

---

## Prompt Scaffold to Copy-Paste

For every self-mod request you build, START from this scaffold and fill in `<...>`:

```
🎯 TASK: <one-liner>

🔧 TARGET FILE(S):
  1. <exact relative path>
  2. ...

📋 CHANGE SPEC:
  - <bullet 1>
  - <bullet 2>

🔍 EXISTING CONTEXT (already in repo — do not invent):
  - <existing pattern reference with file + line numbers>
  - <historical note if relevant>

✅ VALIDATION STEPS (in addition to automatic S5/S6/S7 via bridge):
  1. <specific edge case test>
  2. ...

⚠️  APPROVAL LEVEL: <Auto / Review / Approve / Controlled>
  Rationale: <cite ai-approval.md lines + reasoning>

FOLLOW WORKFLOW: .opencode/workflows/opencode-self-mod.md
  → Apply 9 Phases exactly as written (Phase -1 through Phase 8)
  → Apply all 12 Safeguards
  → Produce Phase -1 Planned Diff BEFORE any writes
  → Run validation via CLI: node scripts/opencode-validate.mjs --all
  → End with Safeguard 10 Standard Report + Safeguard 12 Dep-graph table
```

---

## Validation Shortcut (Copy-Paste Shell)

After Phase 3, the agent can run this ONE command as a super-sanity check for S5-S7 + idempotency baseline:

```bash
node --input-type=module -e "
import('./src/integration/OpenCodeBridge.mjs').then(async m=>{
  const b = new m.OpenCodeBridge();
  const snap = b.snapshotForRollback();
  const integ = b.validateIntegrity();
  const ctx = b.getSystemContext();
  const requiredCtxKeys = ['agents','memory','workflows','policies','approvalRequired','dataSources'];
  console.log('=== OpenCode Integrity ===');
  console.log('rollback snapshot:', snap.snapshotTakenAt);
  console.log('constructor threw: NO');
  console.log('schemaErrors:', integ.schemaErrors.length, integ.schemaErrors);
  console.log('schemaWarnings:', integ.schemaWarnings.length, integ.schemaWarnings);
  console.log('brokenRegistry:', integ.brokenRegistry.length, integ.brokenRegistry);
  console.log('orphanedFiles:', integ.orphanedFiles.length, integ.orphanedFiles);
  console.log('sweep all ok:', integ.ok);
  console.log('systemContext has 6 required keys:', requiredCtxKeys.every(k=>k in ctx));
  console.log('configSignature (idempotency baseline):', integ.idempotency.configSignature);
  const diag = await b.runDiagnostics();
  console.log('diagnostics overall ok:', diag.ok);
  process.exit(integ.ok && diag.ok && requiredCtxKeys.every(k=>k in ctx) ? 0 : 1);
}).catch(e=>{console.error('FAIL:', e.message); process.exit(2)})
"
```

Exit code 0 = Phases 4-6 are clean. Non-zero = run rollback.

---

## Safeguard 11 — Dry-Run Planned Diff (Phase -1)

**Prompt requirement**: BEFORE any disk write, produce a human-readable planned-diff block containing the complete set of files, action types, and estimated line deltas.

```
Planned changes
===============

Modify (+N/-M):
  - .opencode/system-config.json
      * Add entry workflows["opencode-self-mod"] → workflows/opencode-self-mod.md

Modify (+N/-M):
  - src/integration/OpenCodeBridge.mjs
      * Add: validateConfigSchema(), REQUIRED_TOP_LEVEL_KEYS, constructor-level throw on schema errors

Create (+214 lines):
  - .opencode/workflows/opencode-self-mod.md

Rename:
  - .opencode/opencode.json → .opencode/system-config.json

Delete:
  (none)

Estimated totals:
  Modified: 2 files (+K / -L lines)
  Created:  1 file (+N lines)
  Renamed:  1 file
  Deleted:  0 files

Approval level: <Auto / Review / Approve / Controlled — re-state here>
[ ] Human approval received (Approve/Controlled only) — waiting → continue only after check
```

**CLI enforcement**: `node scripts/opencode-validate.mjs --dry-run` computes current vs planned diff signature so humans can spot drift.

---

## Safeguard 12 — Dependency-Graph Chain Validation

**Prompt requirement**: For EVERY registered entry (not just the one you touched) walk the complete 6-stage dependency chain. Any non-green stage = fail + rollback.

```
Dependency chain — one row per registered entry
================================================

agents/engineering.md:
  (1) in system-config.json?  YES
  (2) .path resolves to existing file?  YES (.opencode/agents/engineering.md size=X lastmod=Y)
  (3) file parses (md first-line present, not corrupt)?  YES (len>0, starts with "# ")
  (4) bridge.loadAgent("engineering") succeeds?  YES
  (5) API endpoint exposes it?  YES  /api/opencode/agents includes engineering; /api/opencode/agent/engineering returns 200
  Result: PASS

memory/architecture.md:
  (1) in system-config.json?  YES
  (2) config["memory"]["architecture"] resolves to existing file?  YES
  (3) file parses?  YES
  (4) bridge.loadMemory("architecture") succeeds?  YES
  (5) API endpoint exposes it?  YES  /api/opencode/memory/architecture returns 200
  Result: PASS

...one row per agents[i] / memory[i] / workflows[i] / policies[i]...
```

**CLI enforcement**: `node scripts/opencode-validate.mjs --depgraph` runs 6-step chain on every entry and prints the PASS/FAIL table above. Exit 0 ⇔ every row = PASS.

---

## Long-Term Recommendations (Future Hardening)

As the project grows, encode these checks into formal tooling rather than prompt text:

1. **Formal schema**
   - `system-config.json` → JSON Schema draft-07 or Zod object (`.opencode/system-config.schema.json`)
   - Each resource `.md` file → YAML frontmatter with required fields: `id`, `version`, `kind` (agent|memory|workflow|policy), `capabilities[]` for agents
   - Frontmatter validation: reject `.md` resources that are missing the `---` frontmatter block or required fields
2. **Dedicated CLI** — `scripts/opencode-validate.mjs` (implemented alongside this workflow revision). Commands:
   ```
   node scripts/opencode-validate.mjs              # same as --all
   node scripts/opencode-validate.mjs --schema     # REQUIRED_TOP_LEVEL_KEYS + types + shape
   node scripts/opencode-validate.mjs --registry   # full sweep + orphans + broken links
   node scripts/opencode-validate.mjs --smoke      # constructor + ctx 6-keys + approval regression
   node scripts/opencode-validate.mjs --depgraph   # 6-stage chain per registered entry (S12)
   node scripts/opencode-validate.mjs --rollback   # snapshot eligibility check
   node scripts/opencode-validate.mjs --all        # everything above + summary table
   ```
   Exit codes: 0 = clean, 1 = warnings only, 2 = hard failures, 3 = internal error
3. **Auto-invoke on change** — add a git pre-commit hook or GitHub Actions step that runs `node scripts/opencode-validate.mjs --all` whenever a commit modifies paths matching: `.opencode/**`, `src/integration/OpenCodeBridge.mjs`, `packages/dashboard/routes/opencode.mjs`
4. **Idempotency replay** — record `configSignature` in a file (`.opencode/_last_signature`) and on CI: if `signature unchanged AND files have changed → fail + warn about drift`
5. **Deprecation shims** — when renaming a key (e.g., old `opencode.json` → new `system-config.json`), keep both files present for 2 CI cycles with a forward-compat shim reading old→new, and warn in schemaWarnings until the old file is retired

