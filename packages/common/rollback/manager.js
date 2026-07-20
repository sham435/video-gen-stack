import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { getDb } from '../database/schema.js'
import { randomUUID } from 'crypto'

const SNAPSHOT_ROOT = process.env.SNAPSHOT_PATH || './snapshots'

export class RollbackManager {
  constructor() {
    this.db = getDb()
    this._init()
  }

  _init() {
    if (!existsSync(SNAPSHOT_ROOT)) mkdirSync(SNAPSHOT_ROOT, { recursive: true })
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        article_id TEXT REFERENCES published_articles(id),
        content_id TEXT NOT NULL,
        version TEXT NOT NULL,
        template_snapshot TEXT,
        audio_snapshot TEXT,
        font_snapshot TEXT,
        render_path TEXT,
        metadata TEXT DEFAULT '{}',
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `)
  }

  async createSnapshot(articleId, contentId, videoPath, reason = 'pre_publish') {
    const id = randomUUID()
    const snapshotDir = join(SNAPSHOT_ROOT, contentId, id)
    mkdirSync(snapshotDir, { recursive: true })

    // Copy render if exists
    let renderPath = null
    if (videoPath && existsSync(videoPath)) {
      renderPath = join(snapshotDir, 'render.mp4')
      copyFileSync(videoPath, renderPath)
    }

    // Snapshot current template state
    const template = this.db.prepare(`SELECT * FROM templates WHERE status = 'active' ORDER BY version DESC LIMIT 1`).get()
    const font = this.db.prepare('SELECT * FROM font_profiles ORDER BY version DESC LIMIT 1').get()
    const audio = this.db.prepare(`SELECT * FROM audio_assets WHERE status = 'active' ORDER BY RANDOM() LIMIT 1`).get()

    const version = `${Date.now()}`
    const metadata = { template: template?.version, font: font?.version, audio: audio?.name }

    writeFileSync(join(snapshotDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
    writeFileSync(join(snapshotDir, 'template.json'), JSON.stringify(template || {}, null, 2))
    writeFileSync(join(snapshotDir, 'font.json'), JSON.stringify(font || {}, null, 2))

    this.db.prepare(`
      INSERT INTO snapshots (id, article_id, content_id, version, template_snapshot, audio_snapshot, font_snapshot, render_path, metadata, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, articleId, contentId, version,
      JSON.stringify(template), JSON.stringify(audio), JSON.stringify(font),
      renderPath, JSON.stringify(metadata), reason)

    return { id, snapshotDir, version }
  }

  getSnapshots(contentId, limit = 5) {
    return this.db.prepare(
      'SELECT * FROM snapshots WHERE content_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(contentId, limit)
  }

  async rollback(snapshotId) {
    const snapshot = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId)
    if (!snapshot) throw new Error('Snapshot not found')

    // Restore template
    if (snapshot.template_snapshot) {
      const tmpl = JSON.parse(snapshot.template_snapshot)
      // Create a new template version from snapshot
      const { TypographyManager } = await import('../typography/manager.js')
      const tm = new TypographyManager()
      tm.createTemplateVersion(tmpl.name || 'restored', { colors: tmpl.colors })
    }

    return snapshot
  }
}
