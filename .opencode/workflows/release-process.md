# Release Process

## Overview
Structured process for releasing new versions of NEWS-MONSTER to production. Every release goes through build → test → stage → production with rollback capability.

## Version Schema
`MAJOR.MINOR.PATCH` (semver)
- MAJOR: Breaking API changes, new subscription tier
- MINOR: Feature additions, pipeline improvements
- PATCH: Bug fixes, performance optimizations

## Release Stages

### 1. Pre-Release Checklist
```
Trigger: Release candidate identified
Agent: Engineering + QA
Actions:
  - Verify all target PRs are merged to develop
  - Run full syntax check: find src/ -name '*.mjs' -exec node --check {} \;
  - Check all JSON templates parse
  - Verify import resolution
  - Run quality checks on sample output
  - Check CI history for recent failures
Output: Release readiness report
```

### 2. Version Bump
```
Trigger: Pre-release check passes
Agent: GitHub Intelligence
Actions:
  - Determine version increment (major/minor/patch)
  - Update version in package.json
  - Generate changelog via ReleaseManager
  - Create release branch: release/v<version>
Gate: Human approval
```

### 3. Staging Deployment
```
Trigger: Release branch created
Infrastructure: Railway (staging)
Agent: DevOps
Actions:
  - Deploy release branch to staging
  - Verify health endpoint: GET /api/health
  - Run smoke test: trigger pipeline with sample article
  - Check video output quality
  - Monitor error logs for 5 minutes
Output: Staging validation report
```

### 4. Production Release
```
Trigger: Staging validated + human approval
Gate: 
  - Human approval from lead engineer
  - All critical/major issues resolved
  - Staging tests pass
  - policy/ai-approval.md followed
Agent: DevOps
Actions:
  - Merge release branch to main
  - Tag release: git tag v<version>
  - Push tag: git push origin v<version>
  - Deploy main to Railway production
  - Verify health endpoint
  - Monitor first 3 pipeline runs
Output: Production release confirmation
```

### 5. Post-Release
```
Trigger: Production release confirmed
Agent: Engineering + GitHub Intelligence
Actions:
  - Generate release notes
  - Update AI_ROADMAP.md if applicable
  - Log release in memory/lessons-learned.md
  - Create GitHub Release with changelog
  - Notify team
Output: GitHub Release + changelog
```

## Rollback Procedure

If production issues detected within 30 minutes of release:

```
Trigger: Critical error in production
Agent: DevOps
Actions:
  1. Identify last stable version
  2. Rollback Railway: redeploy previous Docker image
  3. Verify health endpoint
  4. Tag current release as BROKEN
  5. Create hotfix branch from previous release
  6. Apply fix on hotfix branch
  7. Follow expedited release process
  8. Log postmortem in memory/lessons-learned.md
```

## Release Artifacts

- Git tag: `v<version>`
- GitHub Release with changelog
- Railway deployment
- Updated version in `package.json`

## Automated Safety Checks

Before any production deployment, verify:
- [ ] Last 5 CI runs pass
- [ ] No unresolved critical issues in codebase
- [ ] Health endpoint responds within 2s
- [ ] Sample video renders without errors
- [ ] Rollback plan documented
- [ ] Environment variables present in Railway
- [ ] Database migrations are idempotent