import { randomUUID } from 'crypto'
import { Router } from 'express'
import { getDb as openDb, initSchema } from '../../../packages/database/news-engine.mjs'
import { validateBody, cronJobSchema } from '../../../packages/validation/schemas.mjs'

const router = Router()

function getDb() {
  const db = openDb()
  initSchema(db)
  return db
}

router.get('/cron-jobs', (req, res) => {
  const db = getDb()
  const jobs = db.prepare('SELECT * FROM cron_jobs ORDER BY created_at').all()
  db.close()
  res.json({ jobs })
})

router.post('/cron-jobs', validateBody(cronJobSchema), (req, res) => {
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
  const values = []
  if (name !== undefined) { updates.push('name = ?'); values.push(name) }
  if (category !== undefined) { updates.push('category = ?'); values.push(category) }
  if (schedule !== undefined) { updates.push('schedule = ?'); values.push(schedule) }
  if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }
  updates.push("updated_at = datetime('now')")
  values.push(req.params.id)
  if (updates.length > 1) {
    db.prepare(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values)
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
