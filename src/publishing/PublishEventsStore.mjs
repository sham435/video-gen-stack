import fs from 'fs'
import path from 'path'

const PUBLISH_EVENTS_FILE = path.resolve(process.cwd(), 'data', 'publish-events.json')

// Publish Events Store — ground-truth artifacts for the learning loop.
//
// Every publish records what the pipeline actually shipped, so analytics
// later have a precise baseline:
//   {
//     "videoId": "abc123",
//     "title": "...",
//     "cta": { "topic": "leak", "mode": "subscribe", "text": "Sub for the next APPLE leak!" },
//     "comment": { "text": "Which feature surprised you most?", "status": "published", "commentId": "xyz" }
//   }
//
// The retention-learning run can join these against real analytics:
// did the CTA exist? did the comment exist? did retention improve?
export class PublishEventsStore {
  constructor() {
    this.events = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(PUBLISH_EVENTS_FILE)) return JSON.parse(fs.readFileSync(PUBLISH_EVENTS_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return []
  }

  record(event) {
    const e = { publishedAt: new Date().toISOString(), ...event }
    this.events.push(e)
    if (this.events.length > 500) this.events = this.events.slice(-500)
    try {
      fs.mkdirSync(path.dirname(PUBLISH_EVENTS_FILE), { recursive: true })
      fs.writeFileSync(PUBLISH_EVENTS_FILE, JSON.stringify(this.events, null, 2))
    } catch { /* ignore */ }
    return e
  }

  recent(n = 20) {
    return this.events.slice(-n)
  }

  byVideo(videoId) {
    return this.events.find(e => e.videoId === videoId) || null
  }

  updateByTitle(title, patch) {
    const e = this.events.find(ev => ev.title === title && ev.pending)
    if (e) {
      Object.assign(e, patch)
      e.pending = false
      this._save()
      return e
    }
    return null
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(PUBLISH_EVENTS_FILE), { recursive: true })
      fs.writeFileSync(PUBLISH_EVENTS_FILE, JSON.stringify(this.events, null, 2))
    } catch { /* ignore */ }
  }
}

export { PUBLISH_EVENTS_FILE }
