// ResumeManager — produces the restart report ("where we left off").
//
// Reads STATE + CHECKPOINT + TODO + recent EVENTS + git + tests and renders a
// compact resume summary so a fresh agent (or a compacted conversation) knows
// exactly where the project stands and what to do next.

import { WorkLogManager } from './WorkLogManager.mjs'
import { execSync } from 'node:child_process'

export class ResumeManager {
  constructor({ worklog = null, cwd = process.cwd() } = {}) {
    this.worklog = worklog || new WorkLogManager()
    this.cwd = cwd
  }

  gitStatus() {
    try {
      const branch = execSync('git branch --show-current', { cwd: this.cwd, encoding: 'utf8' }).trim()
      let clean = true
      try { clean = execSync('git status --porcelain', { cwd: this.cwd, encoding: 'utf8' }).trim() === '' } catch { clean = false }
      const lastCommit = execSync('git log --oneline -1', { cwd: this.cwd, encoding: 'utf8' }).trim().split(' ')[0]
      return { branch, clean, lastCommit }
    } catch { return { branch: 'unknown', clean: false, lastCommit: null } }
  }

  latestTests() {
    const state = this.worklog.state()
    return state.tests || { lastCommand: null, passed: null, failed: null }
  }

  /** Build the full resume snapshot. */
  resume() {
    const state = this.worklog.state()
    const cp = this.worklog.checkpoint() || {}
    const todo = this.worklog.todo()
    const tasks = todo.tasks || []
    const events = this.worklog.recentEvents(12)

    const activeTask = tasks.find(t => t.status === 'in_progress') || tasks.find(t => t.id === (cp.currentTask || state.currentTask)) || null
    const completed = tasks.filter(t => t.status === 'completed')
    const blocked = tasks.filter(t => t.status === 'blocked')

    const session = state.session || {}
    const stale = session.status === 'active' && WorkLogManager.isStaleHeartbeat(session.lastHeartbeat)

    return {
      project: state.project,
      repository: state.repository,
      phase: state.currentPhase,
      currentTask: activeTask ? { id: activeTask.id, title: activeTask.title, status: activeTask.status } : { id: cp.currentTask || state.currentTask, status: 'unknown' },
      lastCompletedAction: cp.lastCompletedAction || state.lastAction,
      lastAction: state.lastAction,
      nextAction: cp.nextExactAction || state.nextAction,
      blockedBy: cp.blockers || state.blockedBy || [],
      tests: this.latestTests(),
      git: this.gitStatus(),
      session: {
        id: session.id,
        status: session.status,
        interrupted: stale,
        lastHeartbeat: session.lastHeartbeat,
      },
      todo: { total: tasks.length, completed: completed.length, inProgress: tasks.filter(t => t.status === 'in_progress').length, blocked: blocked.length, pending: tasks.filter(t => t.status === 'pending').length },
      recentEvents: events,
    }
  }

  /** Human-readable resume report (the box the agent shows on start). */
  render(resume = this.resume()) {
    const L = []
    L.push('╔══════════════════════════════════════════════════════════╗')
    L.push('║ NEWS-MONSTER — RESUME CHECKPOINT                          ║')
    L.push('╚══════════════════════════════════════════════════════════╝')
    L.push(`Phase:           ${resume.phase || 'unknown'}`)
    L.push(`Current task:    ${resume.currentTask?.id || 'none'} — ${resume.currentTask?.title || ''}`)
    L.push(`Status:          ${resume.currentTask?.status || 'unknown'}${resume.session.interrupted ? '  ⚠ session was INTERRUPTED' : ''}`)
    L.push(`Last completed:  ${resume.lastCompletedAction || '—'}`)
    L.push(`Last action:     ${resume.lastAction || '—'}`)
    L.push(`NEXT ACTION:     ${resume.nextAction || '—'}`)
    const t = resume.tests || {}
    L.push(`Last test:       ${t.lastCommand ? `${t.passed ?? '?'} passed / ${t.failed ?? '?'} failed (${t.lastCommand})` : 'no test record'}`)
    L.push(`Git:             branch=${resume.git?.branch} clean=${resume.git?.clean} last=${resume.git?.lastCommit}`)
    L.push(`TODO:            ${resume.todo?.total ?? 0} total · ${resume.todo?.completed ?? 0} done · ${resume.todo?.inProgress ?? 0} in progress · ${resume.todo?.blocked ?? 0} blocked`)
    if (resume.blockedBy?.length) L.push(`Blockers:        ${resume.blockedBy.join(', ')}`)
    else L.push(`Blockers:        none`)
    L.push(`Session:         ${resume.session?.id || 'none'} (${resume.session?.status || '?'})`)
    return L.join('\n')
  }
}