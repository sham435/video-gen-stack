# Lessons Learned

## Engineering Postmortems

### 2026-07-28: CI Pipeline Crash Chain (69ca579)

**Symptom**: GitHub Actions publish workflow failed with `ffmpeg: Error opening input file output/narration.mp3`

**Root Cause Chain**:
1. `AssetManager.resolve` pushed raw `resolveFn` result instead of merging with scene → `narration` property lost
2. `ScenePlanner.buildNarrationScript` produced empty string (scenes had no narration)
3. ElevenLabs TTS received empty text → returned HTTP 200 with non-MP3 response
4. `VoiceSync.generateTTS` wrote response directly to `narration.mp3` without validation
5. FFmpeg failed to open invalid MP3 in audio mixing stage

**Secondary Failures**:
- `ScenePlanner.buildScene` didn't set `subheadline`/`text` → `BreakingBanner` crashed on `.toUpperCase()`
- Entry-point check used `import.meta.url.endsWith('index.mjs')` which is always true → side-effect `run()` fired on import
- `AudioMixer.mixAudio` used shell-string ffmpeg with no error diagnostics
- `VoiceSync.fallbackTTS` used `espeak --stdout` (raw PCM) instead of `espeak -w` (WAV)

**Fixes Applied**:
- `AssetManager.resolve`: Merge scene with resolveFn result
- `ScenePlanner.buildScene`: Add `text` and `subheadline` fallbacks
- `VoiceSync.generateTTS`: Validate output with ffprobe, fallback chain
- `VoiceSync.fallbackTTS`: Use `espeak -w` for WAV output
- `AudioMixer.mixAudio`: `execFileSync` with input diagnostics on failure
- `index.mjs`: Proper ESM entry check via `fileURLToPath`

**Prevention**:
- All external API responses should be validated before use
- Scene objects must have all properties that renderers expect
- Fallback chains need validation at each step
- FFmpeg commands should include error diagnostics
- ESM entry-point checks must use `fileURLToPath` + `path.resolve`

### 2026-07-27: NaN totalDuration (4c7cf4d)

**Symptom**: Broadcast rendering produced NaN frames, FFmpeg concat failed with "invalid duration 'NaN'"

**Root Cause**: `timedScenes[last].end` was undefined or NaN → `totalDuration` was NaN

**Fix**: Added fallback `isNaN(rawDuration) || rawDuration < 15 ? 30 : rawDuration`

**Prevention**: Always validate numeric values before arithmetic operations

## Engineering Principles Derived

1. **Validate at boundaries**: Check external API responses, file I/O, user input at the system boundary
2. **Fallback every external dependency**: Assume every API call can fail; provide degradation path
3. **Log context with errors**: When an error occurs, log the state that led to it (file sizes, counts, paths)
4. **Verify output before use**: After writing a file, verify it's valid before passing to next stage
5. **Array arguments over shell strings**: Use `execFileSync` for FFmpeg to avoid shell escaping issues
6. **Scene objects are contracts**: All properties a renderer reads must be set during scene construction
7. **One fix per root cause**: Trace the full error chain before fixing; patch at every layer