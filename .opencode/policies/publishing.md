# Publishing Policy

## Scope
All content published through NEWS-MONSTER to YouTube, TikTok, or any other platform.

## Content Standards

### Prohibited Content
- Misleading or false information
- Unsubstantiated claims presented as fact
- Hate speech, harassment, or discrimination
- Copyrighted material without license
- Political endorsements or campaign content
- Financial advice or stock recommendations
- Medical advice or health claims
- Violence or gore

### Required Disclosures
- AI-generated content should be labeled as such in description
- Sources cited in video description
- Sponsored content requires explicit disclosure

## Publishing Workflow

### Standard (Automated)
```
1. News article fetched → quality checked → video produced
2. Quality gate: score > 60% and no critical warnings
3. Video published to YouTube as "public" or "unlisted"
4. Publish event logged to DB audit_log
5. YouTube URL returned
```

### Review Required (Manual Approval)
Triggers that require human review before publishing:
- Content quality score < 70%
- Category is "politics" or "health"
- First video of the day
- Template or pipeline was recently modified
- Any publish failure in the last 3 attempts

## YouTube Publishing

### API
- YouTube Data API v3 via OAuth2
- Scope: `https://www.googleapis.com/auth/youtube.upload`
- Auth: Refresh token stored in env, client credentials in env

### Video Requirements
- Format: MP4 with H.264 video + AAC audio
- Resolution: 1080x1920 (Shorts format)
- Duration: 15-60 seconds (Shorts max)
- File size: Under 256MB (YouTube limit)
- Thumbnail: Auto-generated (or AI-generated in future)

### Metadata
- Title: `<headline> | NEWS-MONSTER` (max 100 chars)
- Description: `{title}\n\nSource: {source}\n\n#news #tech #[category] #NEWSMONSTER`
- Tags: `#NEWSMONSTER, #[category], #news, #breaking`
- Privacy: Controlled by `YOUTUBE_PRIVACY` env var (default: public)

## TikTok Publishing

### API
- TikTok OAuth2 via redirect flow
- Scoped permissions for video upload
- Auth tokens refreshed on each use

### Video Requirements
- Format: MP4
- Resolution: 1080x1920 (portrait)
- Duration: 10-60 seconds
- File size: Under 100MB

## Rate Limits
- YouTube: 10 uploads per day (standard quota)
- TikTok: Rate limits per app (monitor 429 responses)

## Failures
1. **Upload fails** → Retry once with exponential backoff
2. **Auth fails** → Log warning, try refresh token
3. **Both fail** → Log to publish_jobs with status=failed, store for manual retry
4. **3 consecutive failures** → Auto-disable publishing, notify via dashboard

## Audit Trail
Every publish event records:
- Timestamp
- Article title and URL
- YouTube/TikTok video ID
- Privacy setting
- Duration
- File size
- Success/failure status
- Error details (if failed)