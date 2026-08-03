import { getDb } from '../../../database/news-engine.mjs'
import { randomUUID } from 'crypto'


export class TypographyManager {
  constructor() {
    this.db = getDb()
    this._init()
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS font_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        font_family TEXT DEFAULT 'Inter',
        headline_size INTEGER DEFAULT 72,
        subtitle_size INTEGER DEFAULT 38,
        body_size INTEGER DEFAULT 28,
        caption_size INTEGER DEFAULT 20,
        line_height REAL DEFAULT 1.2,
        letter_spacing REAL DEFAULT -0.5,
        font_weight_headline INTEGER DEFAULT 800,
        font_weight_body INTEGER DEFAULT 500,
        color_primary TEXT DEFAULT '#F8FAFC',
        color_muted TEXT DEFAULT '#94A3B8',
        version TEXT DEFAULT 'v1',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        version TEXT DEFAULT 'v1',
        colors TEXT DEFAULT '{"bg":"#07111F","primary":"#3B82F6","accent":"#22D3EE","success":"#10B981","danger":"#EF4444"}',
        font_profile_id TEXT REFERENCES font_profiles(id),
        audio_preset_id TEXT,
        transitions TEXT DEFAULT '["blur","glass_wipe","light_sweep"]',
        safe_area REAL DEFAULT 0.1,
        intro_duration REAL DEFAULT 2.5,
        scene_duration REAL DEFAULT 5,
        outro_duration REAL DEFAULT 3,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `)

    // Seed default font profile
    this.db.prepare(`INSERT OR IGNORE INTO font_profiles (id, name) VALUES ('default', 'tech_news_v3')`).run()

    // Seed default template
    this.db.prepare(`INSERT OR IGNORE INTO templates (id, name, font_profile_id) VALUES ('default', 'technology_news', 'default')`).run()
  }

  getFont(name = 'tech_news_v3') {
    return this.db.prepare('SELECT * FROM font_profiles WHERE name = ? OR id = ? ORDER BY version DESC LIMIT 1')
      .get(name, name)
      || this.db.prepare('SELECT * FROM font_profiles ORDER BY version DESC LIMIT 1').get()
  }

  getTemplate(name = 'technology_news') {
    return this.db.prepare(`SELECT * FROM templates WHERE (name = ? OR id = ?) AND status = 'active' ORDER BY version DESC LIMIT 1`)
      .get(name, name)
      || this.db.prepare(`SELECT * FROM templates WHERE status = 'active' ORDER BY version DESC LIMIT 1`).get()
  }

  createTemplateVersion(name, updates = {}) {
    const current = this.db.prepare('SELECT * FROM templates WHERE name = ? ORDER BY version DESC LIMIT 1').get(name)
    const versionParts = (current?.version || 'v0').replace('v', '').split('.')
    const newVersion = `v${parseInt(versionParts[0]) + 1}.0`
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO templates (id, name, version, colors, font_profile_id, audio_preset_id, transitions, safe_area, intro_duration, scene_duration, outro_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, newVersion,
      updates.colors || current?.colors || '{"bg":"#07111F","primary":"#3B82F6","accent":"#22D3EE"}',
      updates.fontProfileId || current?.font_profile_id || 'default',
      updates.audioPresetId || current?.audio_preset_id,
      updates.transitions || current?.transitions || '["blur","glass_wipe","light_sweep"]',
      updates.safeArea ?? current?.safe_area ?? 0.1,
      updates.introDuration ?? current?.intro_duration ?? 2.5,
      updates.sceneDuration ?? current?.scene_duration ?? 5,
      updates.outroDuration ?? current?.outro_duration ?? 3,
    )
    return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  }

  getActiveVersion(name) {
    return this.db.prepare(`SELECT * FROM templates WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1`).get(name)
  }

  validateText(text, fontProfile) {
    const maxWords = 12
    const maxChars = 72
    const issues = []

    const words = text.split(/\s+/)
    if (words.length > maxWords) issues.push(`${words.length} words exceeds ${maxWords} word limit`)
    if (text.length > maxChars) issues.push(`${text.length} chars exceeds ${maxChars} char limit`)

    return {
      passed: issues.length === 0,
      issues,
      wordCount: words.length,
      charCount: text.length,
      suggested: words.length > maxWords
        ? words.slice(0, maxWords).join(' ') + '…'
        : text,
    }
  }
}
