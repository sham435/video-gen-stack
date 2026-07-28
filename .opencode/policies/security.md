# Security Policy

## Scope
All code, infrastructure, and data within the NEWS-MONSTER platform.

## Secrets Management

1. **Never commit secrets**: API keys, tokens, passwords must never appear in source code
2. **Environment variables only**: All secrets via `.env` (local) or GitHub Secrets / Railway env vars
3. **`.env.example` as template**: Document required vars without values; never commit actual `.env`
4. **Secret rotation**: API keys should be rotated every 90 days
5. **Audit trail**: All secret access logged in database audit_log table

## API Security

1. **API keys**: Engine APIs require `Authorization` header or env var matching
2. **OAuth**: YouTube/TikTok publish uses OAuth2 with refresh tokens only
3. **CORS**: Express CORS middleware configured (currently permissive — restrict in production)
4. **Rate limiting**: Not yet implemented — should be added before public launch
5. **Input validation**: All API inputs validated before processing

## Infrastructure Security

1. **Docker**: Node 22-slim base image, no unnecessary packages
2. **Railway**: Health check endpoint exposed, no debug endpoints in production
3. **Database**: SQLite file permissions — readable only by application user
4. **Network**: No external ports beyond 3001 (API) and 3456 (dashboard)

## Code Security

1. **No eval**: Never use `eval()` or `new Function()`
2. **Shell injection**: Use `execFileSync` with array arguments instead of shell strings
3. **Path traversal**: Validate file paths before reading/writing
4. **Dependency scanning**: Review critical dependencies (`@napi-rs/canvas`, `better-sqlite3`, `express`)
5. **No hardcoded credentials**: Even for development

## Vulnerability Response

1. **Critical**: Immediate halt → rollback to last known good → fix → redeploy
2. **High**: Fix within 24 hours → patch release
3. **Medium**: Include in next release cycle
4. **Low**: Log in technical debt tracker

## Prohibited Actions

- Pushing secrets to any branch
- Modifying secrets through AI agent (requires manual approval)
- Exposing internal ports to public
- Skipping OAuth for publish endpoints
- Disabling audit logging