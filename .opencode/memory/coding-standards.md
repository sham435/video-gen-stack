# Coding Standards

## General

- **Language**: JavaScript (ESM), no TypeScript in main project
- **Module type**: ES modules (`import`/`export`, not `require`)
- **File extensions**: `.mjs` for all source files (explicit ESM)
- **Node version**: 22.x (current LTS)
- **Formatting**: No Prettier or ESLint config found — maintain consistent style manually

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `NewsBroadcastEngine` |
| Files | PascalCase for classes, kebab-case for configs | `AudioMixer.mjs`, `tech-news.json` |
| Functions/Methods | camelCase | `generateFromArticle()` |
| Variables | camelCase | `totalDuration` |
| Constants | UPPER_SNAKE_CASE or `const` at module level | `MUSIC_DIR`, `RENDER_FPS` |
| Private methods | No underscore prefix (use naming intent) | `buildPrompt()` |
| Directories | kebab-case | `video-studio/`, `design-system/` |

## File Organization

```
One class per file, exported as default or named export.
File name matches class name.
```

## Import Style

```javascript
// Core modules first
import fs from 'fs'
import path from 'path'
// Then npm packages
import { execSync } from 'child_process'
// Then local modules (relative paths)
import { SceneEngine } from './video/SceneEngine.mjs'
import { AudioMixer } from './audio/AudioMixer.mjs'
```

## Error Handling

- Use try/catch around external calls (APIs, FFmpeg, file I/O)
- Log errors with context before rethrowing
- Fallback chains for all external dependencies
- Never silently swallow errors without logging
- Prefer early returns over deep nesting

## Async Patterns

```javascript
// Good
async function process(scene) {
  const result = await fetchData(scene)
  return transform(result)
}

// Avoid unnecessary async wrapper
function syncFn() { return 42 }  // fine
```

## Output and Logging

- Use `console.log` for pipeline progress
- Use `console.warn` for non-fatal issues
- Use `console.error` for failures with context
- Use `process.stdout.write` for progress indicators (carriage return)
- Include metrics (duration, size, count) in log messages

## Code Patterns to Follow

1. **Pipeline pattern**: Sequential async steps with logging at each stage
2. **Fallback chain**: Primary → fallback → last resort (each validated)
3. **Configuration**: Category-config maps, env vars for secrets
4. **Resource cleanup**: Use `try/finally` for temp files
5. **Validation**: Check inputs before processing (file exists, size > 0, valid format)

## Patterns to Avoid

- Shell string construction for FFmpeg (use `execFileSync` with array arguments)
- Silent catch blocks without logging
- Hardcoded paths (use `path.join` or config constants)
- Duplicate property assignments in object literals
- Unused imports or variables

## OpenCode Self-Modification Standard

When an AI agent modifies ANY OpenCode-internal file (`.opencode/**` OR `src/integration/OpenCodeBridge.mjs` OR `packages/dashboard/routes/opencode.mjs` OR `.github/workflows/opencode-*.yml`):

1. **Use the workflow**: Follow `.opencode/workflows/opencode-self-mod.md` — 8 Phases + 10 Safeguards, no shortcuts.
2. **Snapshot before edit**: `(new OpenCodeBridge()).snapshotForRollback([...files])` — restore on ANY validation failure.
3. **Validate the hard way**: Run `validateIntegrity()` (not just JSON.parse). Required: 0 schemaErrors, 0 brokenRegistry, full-sweep all pass, orphans empty or explained.
4. **Minimal diffs only**: No whitespace cleanups adjacent to changes. Max 40 lines/file for Review-level.
5. **Report in standard format**: End with the Safeguard 10 Standard Report block exactly as written in the workflow doc.
6. **No orphaned .md files**: If you create a file in `.opencode/{agents,memory,workflows,policies}/`, register it in `system-config.json` in the SAME edit.
7. **Preserve existing API**: `getSystemContext()` must always return its 6 historical keys. Schema changes to REQUIRED_TOP_LEVEL_KEYS require Approve-level approval (see ai-approval.md lines 36-45).