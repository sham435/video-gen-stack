import { getDb } from '../../database/news-engine.mjs'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'

const LUFS_TARGET = -14

export class AudioManager {
  constructor() {
    this.db = getDb()
    this._init()
  }

  _init() {
    this.db.exec(`
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
    `)

    this.db.exec(`INSERT OR IGNORE INTO audio_mix_presets (id, name) VALUES ('default', 'Default Professional Mix')`)

    const tracks = [
      { name: 'technology_future_v1', category: 'technology', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', duration: 60, bpm: 128, license: 'free', volume_level: -24 },
      { name: 'corporate_news_v1', category: 'corporate', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', duration: 60, bpm: 110, license: 'free', volume_level: -22 },
      { name: 'documentary_v1', category: 'documentary', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', duration: 60, bpm: 90, license: 'free', volume_level: -26 },
      { name: 'cinematic_v1', category: 'cinematic', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', duration: 60, bpm: 100, license: 'free', volume_level: -28 },
      { name: 'breaking_alert_v1', category: 'breaking_news', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', duration: 60, bpm: 140, license: 'free', volume_level: -20 },
      { name: 'shorts_v1', category: 'shorts', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', duration: 30, bpm: 130, license: 'free', volume_level: -22 },
    ]
    const insert = this.db.prepare('INSERT OR IGNORE INTO audio_assets (id, name, category, url, duration, bpm, license, volume_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const t of tracks) {
      insert.run(randomUUID(), t.name, t.category, t.url, t.duration, t.bpm, t.license, t.volume_level)
    }
  }

  selectTrack(category, targetDuration) {
    const tracks = this.db.prepare(
      `SELECT * FROM audio_assets WHERE category = ? AND status = 'active' ORDER BY ABS(duration - ?) LIMIT 1`
    ).all(category, targetDuration)
    if (tracks.length > 0) return tracks[0]
    return this.db.prepare(`SELECT * FROM audio_assets WHERE status = 'active' ORDER BY RANDOM() LIMIT 1`).get()
  }

  getPreset(name = 'default') {
    return this.db.prepare('SELECT * FROM audio_mix_presets WHERE name = ?').get(name)
      || { voice_db: -6, music_db: -24, sfx_db: -12, duck_reduce_percent: 40, lufs_target: -14 }
  }

  checkQuality(audioPath) {
    try {
      const output = execSync(
        `ffprobe -v quiet -print_format json -show_streams "${audioPath}"`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString()
      const data = JSON.parse(output)
      const stream = data.streams?.find(s => s.codec_type === 'audio')
      if (!stream) return { passed: false, reason: 'no audio stream' }
      const issues = []
      if ((stream.sample_rate || 0) < 44100) issues.push('sample rate < 44.1kHz')
      if (stream.channels < 2) issues.push('mono instead of stereo')
      return { passed: issues.length === 0, issues, sampleRate: stream.sample_rate, channels: stream.channels, codec: stream.codec_name }
    } catch {
      return { passed: false, reason: 'ffprobe failed' }
    }
  }
}
