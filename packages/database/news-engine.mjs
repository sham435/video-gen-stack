import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.NEWS_DB_PATH || resolve(__dirname, '..', '..', 'data', 'newsroom.db')

const MIGRATIONS = [
  {
    version: 1,
    sql: `
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

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL DEFAULT 'technology',
        schedule TEXT DEFAULT '*/30 * * * *',
        enabled INTEGER DEFAULT 1,
        last_run TEXT,
        next_run TEXT,
        last_status TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO cron_jobs (id, name, category) VALUES
        ('cron-tech-news', 'Tech News', 'technology'),
        ('cron-ai-news', 'AI News', 'technology'),
        ('cron-science', 'Science', 'science'),
        ('cron-business', 'Business', 'business');

      CREATE TABLE IF NOT EXISTS pipeline_snapshots (
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

      INSERT OR IGNORE INTO font_profiles (id, name) VALUES ('default', 'tech_news_v3');

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

      INSERT OR IGNORE INTO templates (id, name, font_profile_id) VALUES ('default', 'technology_news', 'default');

      CREATE TABLE IF NOT EXISTS audio_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        file_path TEXT,
        url TEXT,
        duration REAL,
        bpm INTEGER,
        license TEXT DEFAULT 'free',
        volume_level REAL DEFAULT -24,
        fade_in REAL DEFAULT 0.5,
        fade_out REAL DEFAULT 1.0,
        version TEXT DEFAULT 'v1',
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audio_mix_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        voice_db REAL DEFAULT -6,
        music_db REAL DEFAULT -24,
        sfx_db REAL DEFAULT -12,
        duck_reduce_percent REAL DEFAULT 40,
        duck_attack_ms REAL DEFAULT 300,
        duck_release_ms REAL DEFAULT 2000,
        lufs_target REAL DEFAULT -14,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO audio_mix_presets (id, name) VALUES ('default', 'Default Professional Mix');
    `,
  },
]

export function getDb() {
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function initSchema(db) {
  const current = db.pragma('user_version', { simple: true })
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    // ROLLBACK: not applicable (additive CREATE TABLE IF NOT EXISTS only)
    db.exec(migration.sql)
    db.pragma(`user_version = ${migration.version}`)
  }
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
