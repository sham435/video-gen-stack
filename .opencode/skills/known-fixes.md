# Skill: Known Production Fixes

When asked about a known production issue or how to fix a reported bug, match the issue against this
list FIRST and apply the proven solution. These were learned from real production runs.

| Issue | Proven Fix | Success |
|---|---|---|
| visualPlan undefined crash | Guard `VisualReasoner.select` with a fallback object | 98% |
| YouTube upload timeout | Retry + exponential backoff on upload | 94% |
| duplicate emphasis text | Drop caption word that matches `caption_focus` | 97% |
| missing cover image | Pexels → article image → FAL → gradient fallback chain | 96% |
| CI render slow | `QUICK_RENDER` skips per-pixel enhancement passes | 92% |
| wrong hashtag brand | `HashtagBuilder` enforces topic-category-profile-channel | 100% |

## Rules
1. Verify the issue actually exists in the code before recommending a fix (file path + line number).
2. Never read `.env` or files under `data/`.
3. If the fix requires a mutation, call it out as requiring approval.
4. If a reported issue is NOT in this list, treat it as a new bug — investigate root cause, do not guess.
