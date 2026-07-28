# Video Production Workflow

## Overview
End-to-end workflow for producing a NEWS-MONSTER broadcast video, from article ingestion to publishing.

## Pipeline Stages

### 1. Article Ingestion
```
Input: NewsAPI headlines or manual article
Agent: Editor-in-Chief
Process:
  - Fetch via NewsAPI with category filter
  - Run CategoryClassifier for tech relevance
  - Filter by tech keywords (ai, apple, google, etc.)
  - Select top article (or use manual fallback)
Output: Article object with title, description, source, url, imageUrl, category
```

### 2. Quality Gate
```
Input: Article
Agent: QA (packages/common/quality/checker.js)
Checks:
  - Headline length: 20-120 characters
  - No offensive language
  - Source is reputable
  - Description is substantive
Gate: If quality check fails, use fallback article
```

### 3. Story Planning
```
Input: Validated article
Agent: Editor-in-Chief via StoryPlanner (LLM)
Process:
  - Build LLM prompt with brand voice guidelines
  - Query OpenRouter with JSON response format
  - Validate story structure (5-8 scenes, 25-35s total)
  - Fallback to hardcoded plan if LLM fails
Output: Story plan with headline, hook, 7 scenes, CTA
```

### 4. Scene Planning
```
Input: Story plan
Agent: Editor-in-Chief via ScenePlanner
Process:
  - Build scene objects with narration, visuals, camera, transitions
  - Assign per-scene durations (2-8s each)
  - Assign timestamps
  - Validate scene continuity
Output: Timed scenes array
```

### 5. Visual Asset Resolution
```
Input: Timed scenes
Agent: Video Director via VisualPlanner + AssetManager
Process:
  - For each scene: resolve visual prompt → search Pexels → (optional) fal.ai
  - Cache assets locally
  - Fallback to article image or gradient
Seq: VisualPlanner.resolveScenes → AssetManager.resolve
Output: Scenes with resolved visual assets
```

### 6. Narration Generation
```
Input: Scene narration text
Agent: VoiceSync
Process:
  - ElevenLabs TTS (primary)
  - If fail: edge-tts (fallback)
  - If fail: espeak -w (last resort)
  - Validate output with ffprobe
  - Check duration > 1s and size > 1KB
Output: narration.mp3
```

### 7. Frame Rendering
```
Input: Scenes + narration
Agent: Video Director via SceneEngine
Process:
  - Calculate total frames (duration * 10fps)
  - For each frame: resolve scene → render Canvas → save PNG
  - Report every 5% progress
  - Handle motion effects, captions, overlays
Output: PNG frames directory
```

### 8. Video Assembly
```
Input: PNG frames + narration.mp3 + background music
Agent: Video Director via FFmpeg
Process:
  - Create concat list from frames with per-frame duration
  - FFmpeg concat → silent_broadcast.mp4
  - FFmpeg audio mix: voice(normalized) + music(10%) → broadcast.mp4
  - FFmpeg footer overlay → broadcast_final.mp4
  - Verify output exists and has valid format
Output: broadcast.mp4
```

### 9. Quality Check
```
Input: Rendered video
Agent: QA via QualityChecker + VideoTestingEngine
Checks:
  - Video duration matches expected
  - No black frames
  - Audio has valid streams
  - Visual quality score > 70
  - Retention prediction > 60%
Output: Quality report
```

### 10. Publishing
```
Input: Approved video
Agent: Publishing Engine
Platforms:
  - YouTube (primary): OAuth2 via youtube.js
  - TikTok (secondary): OAuth via tiktok.js
Process:
  - Upload with title, description, tags
  - Set privacy: public/unlisted
  - Log publish job to database
  - Return video URL
Output: YouTube URL (https://youtu.be/<id>)
```

## Quality Thresholds

| Metric | Target | Minimum |
|--------|--------|---------|
| Duration | 25-35s | 15s |
| Frame count | 250-350 | 150 |
| Audio duration | matches video | > 15s |
| Voice file size | > 100KB | > 1KB |
| Output file size | > 1MB | > 100KB |
| Video format | H.264+AAC | valid mp4 |
| Quality score | > 80% | > 60% |

## Error Handling Per Stage

Each stage has a fallback behavior:
```
1. NewsAPI fails → use hardcoded fallback article
2. Quality check fails → use fallback article
3. LLM fails → use hardcoded story plan
4. Pexels fails → use article image or gradient
5. ElevenLabs fails → edge-tts → espeak
6. FFmpeg fails → log diagnostics, retry once
7. YouTube fails → log for manual retry
```