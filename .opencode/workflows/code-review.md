# Code Review Workflow

## Overview
Standardized code review process for all pull requests. Ensures quality, consistency, and knowledge sharing.

## Triggers
- Pull request opened against `develop` or `main`
- PR marked as "ready for review"

## Review Stages

### 1. Automated Pre-Review
```
Trigger: PR opened
Agent: GitHub Intelligence
Actions:
  - Fetch PR diff via `gh`
  - Run syntax check on changed files
  - Check for `.env` or secrets exposure
  - Verify target branch policy
  - Check CI status for related workflows
Output: Pre-review summary
```

### 2. Agent Review
```
Trigger: Pre-review complete
Agent: Engineering (primary) + Subject-matter agents
Actions:
  - Read changed files with context (surrounding 20 lines)
  - Check against coding-standards.md
  - Verify error handling patterns
  - Check for edge cases
  - Verify test coverage if applicable
Output: Agent review report with:
  - Score (0-100)
  - Summary of changes
  - Issues found (severity: critical/major/minor/nit)
  - Recommendations
```

### 3. Subject-Matter Review
```
Trigger: If changes touch specific subsystems
Agent: 
  - UI changes → agent/ui-lead
  - Video pipeline → agent/video-director
  - Content/AI → agent/editor-in-chief
  - Infrastructure → agent/devops
Actions:
  - Review changes within domain expertise
  - Check domain-specific patterns
  - Verify memory file alignment
Output: Domain-specific review notes
```

### 4. Human Review
```
Trigger: Agent reviews complete
Gate: All critical and major issues resolved
Process:
  - Human reads agent review reports
  - Human reviews code changes
  - Human either approves or requests changes
  - If changes requested, cycle back to implementation
Output: PR approval or change request
```

## Review Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| APPROVED | No issues, ready to merge | Human can merge |
| APPROVED_WITH_NITS | Minor suggestions only | Human merges after optional fixes |
| CHANGES_REQUESTED | Issues that must be addressed | Implement fixes, re-request review |
| BLOCKED | Security/infrastructure concern | Escalate to lead engineer |

## Review Checklist

### For Every PR
- [ ] No secrets or credentials exposed
- [ ] No direct pushes to `main`
- [ ] Syntax passes on all changed files
- [ ] Imports are valid
- [ ] Error handling covers failure paths
- [ ] Changes don't break existing API contracts
- [ ] New dependencies have approval
- [ ] Schema changes have rollback plan
- [ ] Logging includes context on errors

### For Video Pipeline PRs
- [ ] Frame count matches expected duration
- [ ] FFmpeg commands don't use shell string construction
- [ ] Audio files validated before mixing
- [ ] Fallback chain exists for external APIs

### For Dashboard PRs
- [ ] Design token usage is consistent
- [ ] No hardcoded colors or fonts
- [ ] Responsive at target resolutions
- [ ] Loading and error states handled