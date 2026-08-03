import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSchema, generateContentId, hashHeadline, normalizeHeadline } from '../packages/database/news-engine.mjs'

const LEGACY_TABLES = [
  'published_articles', 'renders', 'assets', 'analytics', 'branding_config', 'pipeline_logs',
  'cron_jobs', 'pipeline_snapshots', 'font_profiles', 'templates', 'audio_assets', 'audio_mix_presets',
]

test('db: migrations create all legacy tables on unified DB', () => {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  for (const t of LEGACY_TABLES) {
    assert.ok(tables.includes(t), `missing table: ${t}`)
  }
  db.close()
})

test('db: user_version tracked by migration', () => {
  const db = new Database(':memory:')
  initSchema(db)
  assert.ok(db.pragma('user_version', { simple: true }) >= 1)
  const before = db.pragma('user_version', { simple: true })
  initSchema(db)
  assert.equal(db.pragma('user_version', { simple: true }), before, 're-run is idempotent')
  db.close()
})

test('db: foreign_keys pragma enforced on unified connection', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  assert.throws(() => {
    db.prepare("INSERT INTO renders (id, article_id, content_id, status) VALUES ('x', 'missing', 'c', 'pending')").run()
  }, /FOREIGN KEY constraint failed/)
  db.close()
})

test('db: seeds present (cron jobs, branding, fonts, templates, mix presets)', () => {
  const db = new Database(':memory:')
  initSchema(db)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cron_jobs').get().c, 4)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM branding_config WHERE id = 'default'").get().c, 1)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM font_profiles WHERE id = 'default'").get().c, 1)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM templates WHERE id = 'default'").get().c, 1)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audio_mix_presets WHERE id = 'default'").get().c, 1)
  db.close()
})

test('db: content id + headline helpers are deterministic', () => {
  const id1 = generateContentId('OpenAI Launches New Model!', 'tech')
  const id2 = generateContentId('OpenAI Launches New Model!', 'tech')
  assert.equal(id1, id2)
  assert.match(id1, /^\d{8}-tech-openai-launches-new-model$/)
  assert.equal(hashHeadline('Breaking News'), hashHeadline('breaking news'))
  assert.equal(normalizeHeadline('The Top 3 AI Stories!'), 'top 3 ai stories')
})

test('db: valid FK insert passes, orphan rejected', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO published_articles (id, content_id, headline, headline_hash, status) VALUES ('a1', 'c1', 'Headline', 'h1', 'approved')").run()
  db.prepare("INSERT INTO renders (id, article_id, content_id, status) VALUES ('r1', 'a1', 'c1', 'pending')").run()
  assert.equal(db.prepare('SELECT COUNT(*) c FROM renders').get().c, 1)
  assert.throws(() => {
    db.prepare("INSERT INTO renders (id, article_id, content_id, status) VALUES ('r2', 'ghost', 'c2', 'pending')").run()
  }, /FOREIGN KEY constraint failed/)
  db.close()
})
