/**
 * V3 Newsroom Database Schema
 *
 * SQLite-backed schema for the full AI news video platform.
 * Supports: ingestion, editorial, templates, rendering, publishing, audit.
 *
 * Tables:
 *   news_articles       — Raw ingested articles from NewsAPI/RSS
 *   editorial_projects  — Production stories (script, storyboard, status)
 *   video_templates     — Versioned render templates (CRUD)
 *   render_jobs         — Render queue + history
 *   publish_jobs        — YouTube publish queue
 *   project_assets      — File paths for generated assets
 *   audit_log           — Every action recorded
 *   users               — Admin/editor/reviewer roles
 */

export const SCHEMA_VERSION = 1

export const CREATE_TABLES = `
-- 1. Users / Roles
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin','editor','reviewer','viewer')),
  api_key     TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. News Articles (ingestion)
CREATE TABLE IF NOT EXISTS news_articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   TEXT,
  source        TEXT NOT NULL DEFAULT 'newsapi',
  title         TEXT NOT NULL,
  description   TEXT,
  content       TEXT,
  url           TEXT,
  image_url     TEXT,
  published_at  TEXT,
  category      TEXT NOT NULL DEFAULT 'technology',
  language      TEXT NOT NULL DEFAULT 'en',
  hash          TEXT,  -- SHA256 of title+source for dedup
  status        TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','PROCESSING','APPROVED','REJECTED','DUPLICATE','ARCHIVED')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON news_articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_hash ON news_articles(hash);
CREATE INDEX IF NOT EXISTS idx_articles_category ON news_articles(category);

-- 3. Editorial Projects (AI-generated stories)
CREATE TABLE IF NOT EXISTS editorial_projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER REFERENCES news_articles(id),
  title           TEXT NOT NULL,
  script          TEXT,
  tts_script      TEXT,
  storyboard_json TEXT,  -- JSON array of scenes
  seo_json        TEXT,  -- JSON: title, description, tags
  quality_score   REAL DEFAULT 0.0,
  editor_status   TEXT NOT NULL DEFAULT 'DRAFT' CHECK(editor_status IN ('DRAFT','REVIEW','APPROVED','RENDERING','PUBLISHED','FAILED')),
  version         INTEGER NOT NULL DEFAULT 1,
  template_id     INTEGER REFERENCES video_templates(id),
  category        TEXT DEFAULT 'technology',
  source_name     TEXT,
  image_url       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON editorial_projects(editor_status);
CREATE INDEX IF NOT EXISTS idx_projects_article ON editorial_projects(article_id);

-- 4. Video Templates (versioned, CRUD)
CREATE TABLE IF NOT EXISTS video_templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  category          TEXT DEFAULT 'technology',
  version           TEXT NOT NULL DEFAULT '1.0',
  scene_schema      TEXT,  -- JSON: scene types, durations
  animation_config  TEXT,  -- JSON: Ken Burns, transitions
  font_config       TEXT,  -- JSON: fonts, sizes
  color_config      TEXT,  -- JSON: palette
  transition_config TEXT,  -- JSON: transition types
  music_config      TEXT,  -- JSON: music style, volume
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
  created_by        INTEGER REFERENCES users(id),
  parent_id         INTEGER REFERENCES video_templates(id),  -- for version chain
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_active ON video_templates(status);

-- 5. Render Jobs (queue + history)
CREATE TABLE IF NOT EXISTS render_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER REFERENCES editorial_projects(id),
  template_version  TEXT,
  renderer_version  TEXT,
  git_commit        TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','rendering','completed','failed','cancelled')),
  started_at        TEXT,
  completed_at      TEXT,
  duration_ms       INTEGER,
  output_path       TEXT,
  error_log         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_render_status ON render_jobs(status);

-- 6. Publish Jobs (YouTube uploads)
CREATE TABLE IF NOT EXISTS publish_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER REFERENCES editorial_projects(id),
  render_job_id   INTEGER REFERENCES render_jobs(id),
  platform        TEXT NOT NULL DEFAULT 'youtube',
  youtube_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','publishing','published','failed','cancelled')),
  privacy         TEXT DEFAULT 'public',
  scheduled_time  TEXT,
  published_time  TEXT,
  override_reason TEXT,
  approved_by     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_publish_status ON publish_jobs(status);

-- 7. Project Assets (file paths)
CREATE TABLE IF NOT EXISTS project_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES editorial_projects(id),
  asset_type  TEXT NOT NULL CHECK(asset_type IN ('image','audio','video','subtitle','snapshot')),
  file_path   TEXT NOT NULL,
  file_size   INTEGER,
  hash        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON project_assets(project_id);

-- 8. Audit Log (every action)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  user_id     INTEGER REFERENCES users(id),
  metadata    TEXT,  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- 9. Snapshots (pre-publish backup)
CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES editorial_projects(id),
  snapshot_path TEXT NOT NULL,
  size_bytes  INTEGER,
  hash        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export const SEED_DATA = `
INSERT OR IGNORE INTO users (id, username, role, api_key) VALUES
  (1, 'admin', 'admin', '${process.env.ADMIN_API_KEY || ''}'),
  (2, 'editor', 'editor', NULL),
  (3, 'reviewer', 'reviewer', NULL);

INSERT OR IGNORE INTO video_templates (id, name, category, version, scene_schema, animation_config, font_config, color_config, transition_config, music_config, status) VALUES
  (1, 'Technology News v1', 'technology', '1.0',
    '{"scenes":[{"type":"headline","duration":5},{"type":"keypoint","duration":4},{"type":"summary","duration":3}]}',
    '{"ken_burns":true,"zoom_range":[1.0,1.12],"parallax":true,"particles":true}',
    '{"headline":"Inter,800,72px","body":"Inter,400,28px","caption":"Inter,500,18px"}',
    '{"bg":["#07111F","#0F172A"],"primary":"#3B82F6","accent":"#22D3EE","text":"#F8FAFC"}',
    '{"type":"fade","duration":0.6,"variants":["fade","blur","light_sweep","directional"]}',
    '{"style":"lofi","volume":0.12,"duck_under_voice":true}',
    'active');
`
