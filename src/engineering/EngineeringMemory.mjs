import fs from 'fs'

const DEBT_FILE = 'memory/engineering/technical_debt.json'
const IMPROVEMENTS_FILE = 'memory/engineering/improvements.json'

export class EngineeringMemory {
  constructor() {
    this.debt = this.load(DEBT_FILE, [])
    this.improvements = this.load(IMPROVEMENTS_FILE, [])
  }

  load(path, def) {
    try { return JSON.parse(fs.readFileSync(path, 'utf-8')) } catch { return def }
  }

  save(path, data) {
    fs.mkdirSync('memory/engineering', { recursive: true })
    fs.writeFileSync(path, JSON.stringify(data, null, 2))
  }

  addDebt(issue) {
    this.debt.push({
      id: Date.now().toString(36),
      ...issue,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    this.save(DEBT_FILE, this.debt)
  }

  resolveDebt(id) {
    const item = this.debt.find(d => d.id === id)
    if (item) { item.resolved = true; item.resolvedAt = new Date().toISOString(); this.save(DEBT_FILE, this.debt) }
  }

  getDebt(status) {
    if (status === 'open') return this.debt.filter(d => !d.resolved)
    if (status === 'resolved') return this.debt.filter(d => d.resolved)
    return this.debt
  }

  addImprovement(imp) {
    this.improvements.push({ id: Date.now().toString(36), ...imp, createdAt: new Date().toISOString(), status: 'proposed' })
    this.save(IMPROVEMENTS_FILE, this.improvements)
  }

  getImprovements(status) {
    return status ? this.improvements.filter(i => i.status === status) : this.improvements
  }

  scanAndRecord() {
    const issues = []
    try {
      const files = this.walk('src')
      for (const f of files) {
        const content = fs.readFileSync(f, 'utf-8')
        if (content.includes('execSync') && !issues.some(i => i.message.includes('execSync')))
          issues.push({ area: 'performance', priority: 'high', message: 'execSync blocks event loop in ' + f, file: f })
        if (content.includes('Math.random()') && f.includes('intro') && !issues.some(i => i.message.includes('Math.random')))
          issues.push({ area: 'determinism', priority: 'medium', message: 'Math.random() in frame rendering in ' + f, file: f })
      }
    } catch {}
    for (const issue of issues) {
      if (!this.debt.some(d => d.message === issue.message && !d.resolved)) this.addDebt(issue)
    }
    return issues
  }

  walk(dir) {
    const results = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = dir + '/' + f
        if (f.startsWith('.')) continue
        try { if (fs.statSync(fp).isDirectory()) results.push(...this.walk(fp))
        else if (f.endsWith('.mjs')) results.push(fp) } catch {}
      }
    } catch {}
    return results
  }
}
