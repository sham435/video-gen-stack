# YouTube Channel Control Plane

Shared coordination for multi-pipeline YouTube publishing.

## Architecture

```
                    SAME YOUTUBE CHANNEL
                            │
                    ┌───────▼────────┐
                    │ GitHub Control  │
                    │     Plane       │
                    └───────┬────────┘
                            │
                  channel-state.json
                            │
             ┌──────────────┴──────────────┐
             │                             │
        NEWS scheduler                MUSIC scheduler
        GitHub Actions                Cloudflare Worker
             │                             │
             └──────────────┬──────────────┘
                            │
                    atomic lease/quota
                            │
                            ▼
                     YouTube Publish
```

## Protocol

Both pipelines follow the same reservation protocol:

```
DISCOVER → RENDER → THUMBNAIL → C2PA → UNIQUENESS
                                            │
                                    RESERVE CHANNEL SLOT
                                            │
                                         UPLOAD
                                            │
                                      ┌─────┴─────┐
                                   success      failure
                                      │            │
                                   COMMIT       RELEASE
```

### RESERVE
- Happens **after** expensive rendering (right before YouTube upload)
- Uses GitHub SHA-checked atomic update (optimistic concurrency)
- Creates a lease with 15-minute TTL (safety net for crashed runners)
- If another pipeline holds an active lease → block/retry

### COMMIT
- After successful upload
- Appends publication record to ledger
- Marks lease as COMMITTED

### RELEASE
- On upload failure
- Decrements quota counter
- Marks lease as RELEASED

## Shared State

`state/channel-state.json` — single source of truth.

```json
{
  "version": 1,
  "day": "2026-08-27",
  "allocations": { "news": 6, "music": 10 },
  "quota": {
    "dailyLimit": 16,
    "news": { "limit": 6, "used": 0 },
    "music": { "limit": 10, "used": 0 },
    "used": 0,
    "remaining": 16
  },
  "lease": null,
  "publications": []
}
```

### Content Allocation vs API Quota

| Concept | What | Example |
|---------|------|---------|
| Content allocation | How many videos each pipeline can publish | news=6, music=10 |
| API quota | YouTube Data API v3 unit consumption | 10,000 units/day |

These are **separate concerns**. Content allocation is a policy decision. API quota is an external constraint.

## Concurrency

Both pipelines read the same file via GitHub Contents API. Optimistic concurrency is enforced via SHA checking:

1. Pipeline A reads: `sha=abc123`
2. Pipeline B reads: `sha=abc123`
3. Pipeline A writes: `PUT sha=abc123` → success → `sha=def456`
4. Pipeline B writes: `PUT sha=abc123` → **409 Conflict**
5. Pipeline B retries: reads `sha=def456`, recalculates, writes again

This gives atomic reservation semantics without distributed locks.

## Lease Expiry

Leases have a 15-minute TTL. If a runner crashes mid-upload:

1. Lease remains ACTIVE with `expiresAt` in the past
2. Next scheduler invocation detects expired lease
3. Expired lease is cleaned up, quota reclaimed
4. Pipeline can proceed

## Day Rollover

At midnight (Asia/Colombo timezone), all counters reset to 0. Allocations are preserved.

## Implementation

### News-monster (vedio_genspark)

```javascript
import { ChannelController } from '../src/governor/ChannelController.mjs'

const channel = new ChannelController()

// Precondition: check quota before UPLOAD stage
job.onPrecondition('UPLOAD', async (ctx) => {
  const check = await channel.canReserve('news')
  return { valid: check.allowed, checks: { channel: check.allowed } }
})

// In UPLOAD handler: reserve → upload → commit/release
const reservation = await channel.reserve('news', jobId)
try {
  const result = await uploadVideo(...)
  await channel.commit('news', jobId, reservation.publicationId, { youtubeVideoId: result.videoId })
} catch (err) {
  await channel.release('news', jobId)
  throw err
}
```

### Music-shorts (video_musicspark)

```javascript
// In Cloudflare Worker, before dispatching PUBLISH stage:
const channel = new ChannelController({ token: env.GH_PAT })
const check = await channel.canReserve('music')
if (!check.allowed) return // defer to next cron cycle
```

## Testing

```bash
# Run channel controller tests
node --test tests/channel-controller.test.mjs

# Key test: 20 sequential reservations with limit=5
# Exactly 5 succeed, 15 rejected, zero duplicate active leases
```
