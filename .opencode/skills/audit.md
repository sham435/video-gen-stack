# Skill: Repository Health Audit

Run this when asked to audit the repo, check readiness, or assess health. Work in order.

## 1. Baseline
1. `repo_stats` — file count, LOC, top dirs/extensions.
2. `git_status` — uncommitted changes, current branch.
3. `git_diff` — what changed (optionally per path).
4. `list_directory` on key dirs: `src/`, `packages/`, `scripts/`, `.opencode/`.

## 2. Checks
- Uncommitted work: flag P1, list exact files.
- Outdated packages: read `package.json`, compare against current versions (report, don't auto-update).
- Dead/unreferenced files: use `grep` to confirm a file is referenced before calling it dead.
- TODO/FIXME: `rg -n "TODO|FIXME"` — distinguish real TODOs from framework strings.
- Running processes: `bash` with `ps` — never assume; verify PID, port, and ownership.

## 3. Output format
```
Current Status: <OK | WARNING | CRITICAL>
Working Correctly: <Full | Partial | None>
Problems Found: <severity, file, root cause, impact>
Improvement Plan: <ordered>
Priority: <P0/P1/P2>
Production Readiness: <scores>
Recommended Next Engineering Tasks: <list>
```

## Rules
1. Never call a file dead without grep evidence it's unreferenced.
2. Never invent file paths — verify with `read_file`/`grep` before reporting them.
3. Never read `.env` or files under `data/`.
4. Report exact severities: P0 = blocking/security, P1 = high impact, P2 = cleanup.
