import fs from 'fs'
import path from 'path'

const SESSIONS_FILE = 'output/video-sessions.json'

const VALID_TRANSITIONS = {
  GENERATED: ['READY_FOR_REVIEW'],
  READY_FOR_REVIEW: ['EDITING_SESSION_ACTIVE', 'APPROVED_FOR_PUBLISH'],
  EDITING_SESSION_ACTIVE: ['APPROVED_FOR_PUBLISH', 'READY_FOR_REVIEW'],
  APPROVED_FOR_PUBLISH: ['PUBLISHED', 'READY_FOR_REVIEW'],
  PUBLISHED: ['LEARNING_COMPLETE'],
  LEARNING_COMPLETE: [],
}

export class SessionManager {
  constructor() {
    this.sessions = this.load()
  }

  load() {
    try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) } catch { return [] }
  }

  save() {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true })
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this.sessions, null, 2))
  }

  create(title, category) {
    const id = `nm_${Date.now().toString(36)}`
    const session = {
      id,
      title: title || 'Untitled',
      category: category || 'technology',
      status: 'GENERATED',
      createdAt: new Date().toISOString(),
      editingWindow: null,
      scores: null,
      publishUrl: null,
      history: [{ timestamp: new Date().toISOString(), action: 'GENERATED' }],
    }
    this.sessions.unshift(session)
    this.save()
    return session
  }

  transition(id, newStatus) {
    const session = this.sessions.find(s => s.id === id)
    if (!session) throw new Error(`Session ${id} not found`)
    const allowed = VALID_TRANSITIONS[session.status] || []
    if (!allowed.includes(newStatus)) {
      throw new Error(`Cannot transition from ${session.status} to ${newStatus}`)
    }
    session.status = newStatus
    session.history.unshift({ timestamp: new Date().toISOString(), action: newStatus })

    if (newStatus === 'READY_FOR_REVIEW') {
      session.editingWindow = {
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }
    }
    if (newStatus === 'PUBLISHED') {
      session.publishedAt = new Date().toISOString()
    }
    this.save()
    return session
  }

  get(id) { return this.sessions.find(s => s.id === id) }

  list(status) {
    if (status) return this.sessions.filter(s => s.status === status)
    return this.sessions
  }

  queue() {
    return {
      generated: this.sessions.filter(s => s.status === 'GENERATED').length,
      readyForReview: this.sessions.filter(s => s.status === 'READY_FOR_REVIEW').length,
      editing: this.sessions.filter(s => s.status === 'EDITING_SESSION_ACTIVE').length,
      approved: this.sessions.filter(s => s.status === 'APPROVED_FOR_PUBLISH').length,
      published: this.sessions.filter(s => s.status === 'PUBLISHED').length,
    }
  }

  updateScore(id, scores) {
    const session = this.sessions.find(s => s.id === id)
    if (session) { session.scores = scores; this.save() }
  }

  setPublishUrl(id, url) {
    const session = this.sessions.find(s => s.id === id)
    if (session) { session.publishUrl = url; this.save() }
  }

  expireWindows() {
    const now = Date.now()
    for (const s of this.sessions) {
      if (s.status === 'EDITING_SESSION_ACTIVE' && s.editingWindow) {
        const expires = new Date(s.editingWindow.expiresAt).getTime()
        if (now > expires) {
          s.status = 'APPROVED_FOR_PUBLISH'
          s.history.unshift({ timestamp: new Date().toISOString(), action: 'AUTO_APPROVED_TIMEOUT' })
        }
      }
    }
    this.save()
  }
}
