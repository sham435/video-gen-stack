# M10 Auto-Pipeline Skill

## What it does
Runs every 30min via GitHub Actions cron. Full loop:
1. Fetch fresh news from Politico RSS (fallback: built-in article)
2. `pickAlgorithm` — assigns one of 48 unique combos (hook × arc × visual × tone × structure)
3. `PublishingEnhancer.enhance` — M9 hashtags (15) + CTA + full description
4. Track in `data/algos-used.json` (48-algo diversity) + `data/pexels-used.json` (48h TTL)
5. Render video with optional `--hideBranding` for clean Shorts
6. Publish with `--with-algo` (ALGO #N/48 injected into description)

## Commands

### Dry run (verify pipeline logic)
```bash
node scripts/cron-pipeline.mjs --with-algo --dry-run
```

### Full run (track + render instructions)
```bash
node scripts/cron-pipeline.mjs --with-algo
```

### Clean Short mode (hideBranding=true)
```bash
node scripts/cron-pipeline.mjs --with-algo --hideBranding
```

### Dashboard — top algos
```bash
curl -H "x-api-key: $ADMIN_API_KEY" http://localhost:3456/api/opencode/top-algos
curl -H "x-api-key: $ADMIN_API_KEY" http://localhost:3456/api/opencode/cron-status
```

### Verify M10
```bash
node verify-m10.mjs
```

## Key files
- `scripts/cron-pipeline.mjs` — main pipeline entry
- `packages/dashboard/routes/top-algos.mjs` — dashboard API routes
- `data/algos-used.json` — algo usage history
- `data/pexels-used.json` — photo reuse tracker (48h TTL)

## Constraints
- Always run `--with-algo` flag
- Never publish without ALGO tag in description
- `hideBranding` only for Promote/Shorts clean mode
- Diversity: re-roll if algo repeated in last 20 runs
