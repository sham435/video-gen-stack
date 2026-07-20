import { Router } from 'express'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'

const router = Router()

function getDb() {
  const dir = './data'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database('./data/news-engine.db')
  db.exec(`
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
    )
  `)

  // Seed default jobs if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get().c
  if (count === 0) {
    const insert = db.prepare('INSERT INTO cron_jobs (id, name, category) VALUES (?, ?, ?)')
    insert.run(randomUUID(), 'Tech News', 'technology')
    insert.run(randomUUID(), 'AI News', 'technology')
    insert.run(randomUUID(), 'Science', 'science')
    insert.run(randomUUID(), 'Business', 'business')
  }
  return db
}

router.get('/cron-jobs', (req, res) => {
  const db = getDb()
  const jobs = db.prepare('SELECT * FROM cron_jobs ORDER BY created_at').all()
  db.close()
  res.json({ jobs })
})

router.post('/cron-jobs', (req, res) => {
  const { name, category, schedule } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  const db = getDb()
  const id = randomUUID()
  db.prepare('INSERT INTO cron_jobs (id, name, category, schedule) VALUES (?, ?, ?, ?)').run(id, name, category || 'technology', schedule || '*/30 * * * *')
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id)
  db.close()
  res.json({ job })
})

router.patch('/cron-jobs/:id', (req, res) => {
  const db = getDb()
  const { name, category, schedule, enabled } = req.body
  const updates = []
  if (name !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`)
  if (category !== undefined) updates.push(`category = '${category.replace(/'/g, "''")}'`)
  if (schedule !== undefined) updates.push(`schedule = '${schedule.replace(/'/g, "''")}'`)
  if (enabled !== undefined) updates.push(`enabled = ${enabled ? 1 : 0}`)
  updates.push("updated_at = datetime('now')")
  if (updates.length > 1) {
    db.prepare(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`).run(req.params.id)
  }
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(req.params.id)
  db.close()
  res.json({ job })
})

router.delete('/cron-jobs/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(req.params.id)
  db.close()
  res.json({ deleted: true })
})

router.post('/cron-jobs/:id/run', (req, res) => {
  const db = getDb()
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  db.prepare("UPDATE cron_jobs SET last_run = datetime('now'), last_status = 'triggered' WHERE id = ?").run(job.id)
  db.close()
  res.json({ triggered: true, category: job.category })
})

export default router
