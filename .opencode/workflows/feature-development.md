# Feature Development Workflow

## Overview
Standard process for adding new features to NEWS-MONSTER. Every feature goes through analysis → design → implementation → review → integration.

## Phases

### 1. Requirements Analysis
```
Input: Feature request from roadmap or user feedback
Agent: Editor-in-Chief + Engineering
Actions:
  - Clarify requirements with memory/product-roadmap.md
  - Check for existing implementations
  - Estimate scope (small/medium/large)
  - Identify affected subsystems
Output: Feature brief (1-2 paragraphs)
```

### 2. Architecture Design
```
Input: Feature brief
Agent: Engineering + Architecture Advisor (memory/architecture.md)
Actions:
  - Design component/module structure
  - Define interfaces and data flow
  - Identify integration points
  - Check against policies
Output: Technical design (3-5 bullet points in the PR description)
```

### 3. Implementation
```
Input: Technical design
Agent: Engineering
Constraints:
  - Follow coding-standards.md
  - Add validation at boundaries
  - Include fallback chains for external deps
  - If ANY modified file is under .opencode/ OR src/integration/OpenCodeBridge.mjs
    OR packages/dashboard/routes/opencode.mjs OR .github/workflows/opencode-*.yml:
        → SWITCH TO workflows/opencode-self-mod.md for the rest of this task
        → Apply its 8 Phases + 10 Safeguards instead of generic implementation steps
  - Else (no OpenCode files touched):
        → Update known_files in .opencode/system-config.json (was: opencode.json, renamed 2026-07-30)
Branch naming: feature/<short-description>
```

### 4. Self-Review
```
Input: Implementation
Agent: Engineering + QA
Actions:
  - Run `node --check` on all new/modified files
  - Verify imports resolve
  - Check for error handling coverage
  - Validate against policies/testing.md
Output: Self-review checklist
```

### 5. Code Review
```
Input: PR with implementation
Agent: GitHub Intelligence + relevant subject-matter agents
Process:
  - agent/github analyzes diff
  - agent/engineering reviews implementation
  - If UI changes: agent/ui-lead reviews
  - If video changes: agent/video-director reviews
Approval: At least one agent approves before human review
```

### 6. Integration Testing
```
Input: Approved PR
Agent: QA
Actions:
  - Run full syntax check across project
  - Verify pipeline stages affected by change
  - Check for regressions in existing features
Output: Test report
```

### 7. Merge
```
Input: Reviewed + tested PR
Gate: Human approval required (policy: ai-approval.md)
Branch: feature/* → develop
```

## Checklist for Every Feature

- [ ] Requirements documented
- [ ] Design reviewed
- [ ] Implementation follows coding standards
- [ ] Error handling added
- [ ] Fallback chains for new external calls
- [ ] Syntax check passes
- [ ] Import resolution verified
- [ ] Affected subsystems tested
- [ ] Known_files updated in .opencode/system-config.json (opencode.json → renamed 2026-07-30)
- [ ] If OpenCode files touched: self-mod workflow applied, integrity check passed, standard report produced
- [ ] Human approval obtained for high-impact changes
