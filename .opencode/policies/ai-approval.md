# AI Approval Policy

## Purpose
Define which actions require human approval vs. which an AI agent can perform autonomously. Ensures all production-impacting changes have human oversight while allowing routine tasks to be automated.

## Approval Levels

| Level | Description | Examples | Who Approves |
|-------|-------------|----------|-------------|
| **Auto** | No approval needed | Syntax fixes, log improvements, comment/doc updates | — |
| **Review** | Agent review + human acknowledge | Bug fixes, test additions, minor refactors | Any engineer |
| **Approve** | Agent review + human approve | New features, dependency updates, schema changes | Lead engineer |
| **Controlled** | Requires explicit go-ahead | Infra changes, security fixes, pipeline changes | Lead + second reviewer |

## Auto (No Approval)

Actions the OpenCode Engine can perform autonomously:
- Run syntax checks (`node --check`)
- Read files and search code
- Generate analysis reports
- Suggest improvements
- Create draft PRs (to feature/ branches only)
- Update `.opencode/` memory and lessons-learned
- Run quality checks on existing output

## Review (Agent + Human Acknowledge)

Actions requiring agent review + human acknowledgment:
- Bug fixes that don't change API contracts
- Adding test coverage
- Minor refactors (rename, extract, inline)
- Updating log messages or error messages
- Adding comments or documentation
- Performance optimizations with verified before/after

## Approve (Agent + Human Approve)

Actions requiring explicit human approval:
- New feature implementation
- Adding or updating dependencies
- Database schema changes (require rollback plan)
- Changes to video pipeline or render logic
- Changes to LLM prompts or template structure
- Branch merges to `develop`
- Any change that modifies `package.json`

## Controlled (Lead + Second Reviewer)

Actions requiring lead engineer + second reviewer:
- Merging to `main`
- Production deployment
- Infrastructure changes (Dockerfile, Railway config, workflows)
- Modifying environment variables or secrets
- Deleting files or directories
- Security-related changes
- Breaking API changes
- Changes to publish pipeline

## Approval Workflow

```
AI Suggestion
    │
    ▼
Identify Level
    │
    ├── Auto ──────→ Execute
    │
    ├── Review ─────→ Generate Patch → Run Tests → Human Acknowledge → Execute
    │
    ├── Approve ───→ Generate Patch → Run Tests → Review Report → Human Approve → Execute
    │
    └── Controlled ─→ Generate Patch → Run Tests → Review Report → Lead Approve → Second Review → Execute
```

## Escalation

If an agent is unsure about the approval level:
1. Default to the higher level
2. Document the uncertainty
3. Human resolves during review

## Bypassing

Emergency hotfixes may bypass approval requirements with:
1. Documented reason in commit message
2. Post-fix review within 24 hours
3. Postmortem logged in lessons-learned.md

## Audit

All approval decisions are logged:
- Action description
- Approval level
- Agent recommendation
- Human decision (approve/reject)
- Timestamp
- Reviewer identity

This log is maintained in the `.opencode/engine` session history and the database audit_log table.