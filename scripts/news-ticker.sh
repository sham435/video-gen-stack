#!/bin/bash
# news-ticker.sh — reliable trigger for the NEWS-MONSTER publish pipeline.
#
# GitHub Actions scheduled cron is unreliable at a 30-min cadence on a quiet
# repo, so a launchd service calls `gh workflow run publish-news.yml` on a
# fixed interval instead. This script:
#   - uses the full gh path (launchd has a minimal PATH)
#   - skips when a publish run is already in progress (its `concurrency:
#     cancel-in-progress` would otherwise kill a mid-render manual run)
#   - logs to /tmp/news-monster.{log,err} plus a persistent run log
#
# Requires gh authenticated as the owning user (stored in ~/.config/gh).

set -uo pipefail

GH="/opt/homebrew/bin/gh"
REPO_DIR="/Users/sham4/vedio_genspark"
LOG_DIR="${TMPDIR:-/tmp}"
RUN_LOG="${LOG_DIR}/news-monster-ticker.log"
STAMP="$(date '+%Y-%m-%dT%H:%M:%S%z')"

log() { printf '%s %s\n' "$STAMP" "$*" >> "$RUN_LOG"; }

# 1) gh must be present + authenticated
if ! "$GH" auth status >/dev/null 2>&1; then
  log "ERROR gh not authenticated — aborting"
  exit 1
fi

# 2) Skip if a publish run is already active (in_progress / queued).
#    Prevents the ticker from cancelling an in-flight render via the
#    workflow's `concurrency: cancel-in-progress: true`.
ACTIVE=$("$GH" run list --workflow=publish-news.yml --status=in_progress --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null)
if [ -n "$ACTIVE" ]; then
  log "INFO publish run $ACTIVE already in progress — skipping"
  exit 0
fi

# 3) Trigger a fresh run
if "$GH" workflow run publish-news.yml --repo sham435/video-gen-stack 2>/tmp/news-monster.err; then
  log "OK triggered publish-news.yml"
  exit 0
else
  log "ERROR trigger failed: $(cat /tmp/news-monster.err | head -1)"
  exit 1
fi
