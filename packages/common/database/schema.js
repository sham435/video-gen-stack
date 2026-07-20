import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID, createHash } from 'crypto'

const DB_PATH = process.env.NEWS_DB_PATH || './data/news-engine.db'

export function getDb() {
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  return db
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS published_articles (
      id TEXT PRIMARY KEY,
      content_id TEXT UNIQUE NOT NULL,
      headline TEXT NOT NULL,
      headline_hash TEXT NOT NULL,
      headline_embedding TEXT,
      url TEXT,
      source TEXT,
      author TEXT,
      article_published_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      youtube_video_id TEXT,
      youtube_title TEXT,
      thumbnail_hash TEXT,
      script_hash TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','published','skipped_duplicate','failed')),
      quality_score REAL,
      rejection_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_articles_hash ON published_articles(headline_hash);
    CREATE INDEX IF NOT EXISTS idx_articles_url ON published_articles(url);
    CREATE INDEX IF NOT EXISTS idx_articles_status ON published_articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_date ON published_articles(created_at);

    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY,
      article_id TEXT REFERENCES published_articles(id),
      content_id TEXT NOT NULL,
      template_version TEXT,
      git_commit TEXT,
      prompt_version TEXT,
      ai_model TEXT,
      render_duration_ms INTEGER,
      render_cost_cents REAL,
      output_path TEXT,
      output_size_bytes INTEGER,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('article','script','storyboard','scene_image','thumbnail','audio_music','audio_narration','subtitle','render_final','youtube_metadata')),
      path TEXT NOT NULL,
      hash TEXT,
      size_bytes INTEGER,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_assets_content ON assets(content_id);

    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      article_id TEXT REFERENCES published_articles(id),
      youtube_video_id TEXT,
      uploaded_at TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      watch_time_seconds REAL DEFAULT 0,
      retention REAL DEFAULT 0,
      ctr REAL DEFAULT 0,
      subscribers_gained INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branding_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      template_version TEXT DEFAULT 'v1',
      logo_path TEXT,
      font_family TEXT DEFAULT 'Inter',
      colors TEXT DEFAULT '{"bg":"#07111F","primary":"#3B82F6","accent":"#22D3EE","text":"#F8FAFC"}',
      intro_duration_seconds REAL DEFAULT 3,
      outro_duration_seconds REAL DEFAULT 5,
      music_style TEXT DEFAULT 'modern-tech-news',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO branding_config (id) VALUES ('default');

    CREATE TABLE IF NOT EXISTS pipeline_logs (
      id TEXT PRIMARY KEY,
      content_id TEXT,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      duration_ms INTEGER,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_content ON pipeline_logs(content_id);
  `)
}

export function generateContentId(headline, category = 'tech') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const slug = headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${date}-${category}-${slug}`
}

export function hashHeadline(headline) {
  return createHash('sha256')
    .update(headline.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .digest('hex')
}

export function normalizeHeadline(headline) {
  return headline
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\b(the|a|an|is|was|were|are|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
