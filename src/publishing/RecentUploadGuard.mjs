// RecentUploadGuard — ground-truth duplicate protection (FEED-005).
//
// The feed/cache ledger layers (PublishEventsStore + union-merge seeder)
// can briefly miss a publication when two runs land close together: run B
// restores its memory snapshot before run A's cache save / feed commit
// completes. The ONLY source that cannot lie about what the channel just
// shipped is the channel itself.
//
// Two cheap API calls (~300ms) before every upload: channels.list(mine)
// → uploads playlist → playlistItems(published titles). If the exact
// normalized title is already on the channel, the composer aborts that
// article with DUPLICATE_RECENT_UPLOAD.
//
// Fail-open on transient API errors (availability beats dedup redundancy:
// the ledger layers already cover the common case; a missing guard must
// never stop the whole publish cadence).

const CHANNEL_RECENT_TTL_MS = 10 * 60e3 // one run's batch is enough
let cached = null // { at, titles }

export function normalizePublishedTitle(t) {
  return String(t || '')
    .replace(/\s*\|\s*NEWS-MONSTER\s*$/i, '')
    .trim()
    .toLowerCase()
    .slice(0, 90)
}

export async function getRecentlyUploadedTitles({ maxResults = 30, ttlMs = CHANNEL_RECENT_TTL_MS } = {}) {
  if (cached && Date.now() - cached.at < ttlMs) return cached.titles
  const { getAccessToken } = await import('../../apps/api/publishers/youtube.js')
  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}` }
  const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', { headers })).json()
  const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) throw new Error('NO_UPLOADS_PLAYLIST')
  const list = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${uploads}`, { headers })).json()
  const titles = new Set((list.items || []).map((it) => normalizePublishedTitle(it?.snippet?.title)))
  cached = { at: Date.now(), titles }
  return titles
}
