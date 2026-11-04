const { listApps, getAllLines } = require('@/services/ingest-store')

// Ingested lines are either JSON events ({ts, ...}) or "<ISO ts> message".
function lineTimestamp(line) {
  if (line.startsWith('{')) {
    try {
      const ts = JSON.parse(line).ts
      if (ts) return ts
    } catch {}
  }
  const first = line.slice(0, line.indexOf(' ')) || line
  return Number.isNaN(Date.parse(first)) ? null : first
}

function buildMatcher(query, isRegex, isCaseSensitive) {
  if (!query) return () => true
  if (isRegex) {
    const re = new RegExp(query, isCaseSensitive ? '' : 'i')
    return (line) => re.test(line)
  }
  const q = isCaseSensitive ? query : query.toLowerCase()
  return (line) => (isCaseSensitive ? line : line.toLowerCase()).includes(q)
}

/**
 * Search ingested logs across one app or all apps.
 * Filters (all optional, ANDed): query, reqId, since, until (ISO timestamps).
 * Returns the newest `limit` matches in chronological order, each with
 * `context` lines before and after it from the same app.
 */
function searchLogs({
  app,
  query,
  regex = false,
  caseSensitive = false,
  reqId,
  since,
  until,
  context = 0,
  limit = 100,
}) {
  let matcher
  try {
    matcher = buildMatcher(query, regex, caseSensitive)
  } catch {
    return { error: 'Invalid regex' }
  }
  const sinceMs = since ? Date.parse(since) : null
  const untilMs = until ? Date.parse(until) : null
  if (Number.isNaN(sinceMs) || Number.isNaN(untilMs)) {
    return { error: 'since/until must be ISO timestamps' }
  }

  const apps = app ? [app] : listApps()
  const matches = []

  for (const name of apps) {
    const lines = getAllLines(name)
    lines.forEach((content, i) => {
      if (reqId && !content.includes(reqId)) return
      if (!matcher(content)) return
      const ts = lineTimestamp(content)
      if (sinceMs !== null || untilMs !== null) {
        const ms = ts ? Date.parse(ts) : NaN
        if (Number.isNaN(ms)) return
        if (sinceMs !== null && ms < sinceMs) return
        if (untilMs !== null && ms > untilMs) return
      }
      const match = { app: name, lineNumber: i + 1, ts, content }
      if (context > 0) {
        match.context = lines
          .slice(Math.max(0, i - context), i + context + 1)
          .map((c, j) => ({ lineNumber: Math.max(0, i - context) + j + 1, content: c }))
          .filter((l) => l.lineNumber !== i + 1)
      }
      matches.push(match)
    })
  }

  matches.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
  return {
    appsSearched: apps,
    totalMatches: matches.length,
    truncated: matches.length > limit,
    results: matches.slice(-limit),
  }
}

module.exports = { searchLogs }
