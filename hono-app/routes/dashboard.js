const { Hono } = require('hono')
const { listApps, getAllLines } = require('@/services/ingest-store')
const { getAuthMiddleware } = require('@/hono-app/middleware/auth')

const router = new Hono()
router.use('*', getAuthMiddleware())

function hourBucket(isoStr) {
  const d = new Date(isoStr)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

router.get('/', (c) => {
  const hours = Math.min(parseInt(c.req.query('hours') ?? '24', 10) || 24, 72)
  const levelsParam = c.req.query('levels') ?? 'error,warn'
  const levels = levelsParam.split(',').map((l) => l.trim()).filter((l) => l === 'error' || l === 'warn')
  const activelevels = levels.length > 0 ? new Set(levels) : new Set(['error', 'warn'])

  const now = new Date()
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000)

  // Pre-build the hourly buckets so hours with zero events still appear
  const bucketStart = new Date(now)
  bucketStart.setUTCMinutes(0, 0, 0)
  const byHour = {}
  for (let i = hours - 1; i >= 0; i--) {
    const key = new Date(bucketStart.getTime() - i * 60 * 60 * 1000).toISOString()
    byHour[key] = { hour: key, errors: 0, warns: 0 }
  }

  const totals = { errors: 0, warns: 0 }
  const appStats = {}
  const codeCounts = {}
  const recentErrors = []

  for (const app of listApps()) {
    for (const line of getAllLines(app)) {
      if (!line.startsWith('{')) continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (!event.ts || !event.level) continue

      const ts = new Date(event.ts)
      if (ts < cutoff) continue

      const level = event.level
      if (level !== 'error' && level !== 'warn') continue

      // Totals
      if (level === 'error') totals.errors++
      else totals.warns++

      // Per-app
      if (!appStats[app]) appStats[app] = { app, errors: 0, warns: 0 }
      if (level === 'error') appStats[app].errors++
      else appStats[app].warns++

      // Hourly bucket
      const bucket = hourBucket(event.ts)
      if (byHour[bucket]) {
        if (level === 'error') byHour[bucket].errors++
        else byHour[bucket].warns++
      }

      // Error codes
      if (event.code) {
        codeCounts[event.code] = (codeCounts[event.code] || 0) + 1
      }

      // Recent errors & warnings list (filtered by requested levels)
      if (!activelevels.has(level)) continue
      recentErrors.push({
        ts: event.ts,
        app,
        level,
        code: event.code ?? null,
        msg: event.msg,
        method: event.method ?? null,
        path: event.path ?? null,
        status: event.status ?? null,
        duration: event.duration ?? null,
        reqId: event.reqId ?? null,
        userId: event.userId ?? null,
        stack: event.stack ?? null,
      })
    }
  }

  const topCodes = Object.entries(codeCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  recentErrors.sort((a, b) => new Date(b.ts) - new Date(a.ts))

  return c.json({
    period: hours,
    totals,
    byApp: Object.values(appStats).sort((a, b) => b.errors - a.errors),
    byHour: Object.values(byHour),
    topCodes,
    recentErrors: recentErrors.slice(0, 25),
  })
})

module.exports = router
