# Skill: Publish / Run Verification

Use this when asked whether a pipeline run published, whether a workflow succeeded, or to verify a
YouTube/LinkedIn post. Do NOT trust run numbers or workflow labels — verify with evidence.

## Steps
1. If a GitHub Actions run number is given, find its real ID:
   - `gh run list` or `bash` with `gh api repos/<owner>/<repo>/actions/runs`.
   - Note: run numbers are per-workflow counters and never reset, even if runs are deleted.
2. Check run logs for publish evidence:
   - YouTube: uploaded short video id (e.g. `oQaDNo3_Rh4`), byte size, timestamp.
   - LinkedIn: post/share URNs (`urn:li:ugcPost:...`, `urn:li:share:...`).
   - `videos.json` refresh commit.
3. Search logs for the exact phrase before claiming a result — e.g. confirm whether "no new video"
   is actually present. A claim of "nothing published" must be backed by grep evidence.
4. If the API is involved, verify with the right headers/keys rather than assuming auth failure.
   A 401 with a wrong/missing key and a 503 from unset key are different failures.

## Rules
1. Never claim a run failed or published without log/grep evidence.
2. Never read `.env` or files under `data/`.
3. If evidence is missing, say so explicitly and request access, don't speculate.
