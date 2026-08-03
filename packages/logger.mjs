import { pino } from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'news-monster', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export function childLogger(component) {
  return logger.child({ component })
}
