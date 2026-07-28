# Testing Policy

## Requirements

Every code change must meet these testing requirements before merging.

## Syntax Validation

- **All source files** must pass `node --check <file>` — enforced in CI
- **All JSON templates** must parse with `JSON.parse()` — enforced in CI
- **All imports** must resolve — verified in CI workflow

## Quality Checks (pre-merge)

Before merging any change, run:
```bash
# Syntax check all modified files
node --check <modified-file>

# Verify JSON templates
node -e "JSON.parse(require('fs').readFileSync('src/templates/<template>.json'))"

# Verify import resolves
node -e "import('<module>')"
```

## Pipeline Validation

For changes affecting video pipeline:
```bash
# Render a test broadcast
NEWSAPI_KEY="" node scripts/composer.mjs "Test Article"

# Verify output
ffprobe -v error -show_entries format=duration,size output/broadcast.mp4
```

## Regression Prevention

1. **Before refactoring**: Note current behavior and outputs
2. **After refactoring**: Verify identical outputs for identical inputs
3. **Dependency changes**: Test with both old and new versions
4. **Schema changes**: Verify backward compatibility with existing data

## Coverage Expectations

| Area | Minimum Coverage | Method |
|------|-----------------|--------|
| Source syntax | 100% | `node --check` (CI) |
| Import resolution | 100% | Runtime test (CI) |
| Template validity | 100% | JSON.parse (CI) |
| Pipeline stages | Manual | Run composer + check output |
| FFmpeg commands | Manual | Validate command constructs |
| Error handling | Manual | Inject failures, verify fallbacks |

## Test Types (by priority)

1. **Syntax validation** — Every file, every commit
2. **Import resolution** — Every module graph
3. **Schema idempotency** — CREATE TABLE IF NOT EXISTS everywhere
4. **Pipeline smoke test** — End-to-end with fallback article
5. **Quality thresholds** — Output meets minimum specs
6. **FFmpeg command validation** — No shell string construction
7. **Error handling** — Each external call has fallback

## CI Enforcement

The `.github/workflows/ci.yml` workflow enforces:
- Syntax check on all `.mjs` files
- JSON template validation
- Module import resolution
- Asset file existence (fonts, templates)

## Exemptions

Emergency hotfixes may skip non-critical tests with explicit human approval documented in the commit message.