import { useState } from 'react'
import { Modal } from 'react-bootstrap'
import {
  useDashboard,
  useIssue,
  type EventDetail,
  type Issue,
  type RecentError,
} from '../hooks/useDashboard'
import Header from './Header'
import '../styles/dashboard.css'

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoStr.slice(11, 16)
  }
}

function formatHourLabel(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoStr.slice(11, 16)
  }
}

function timeAgo(isoStr: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(isoStr).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Which issue is open, and optionally which of its occurrences to show first. */
interface OpenIssue {
  fingerprint: string
  focus?: RecentError
}

export default function Dashboard() {
  const [hours, setHours] = useState(24)
  const [open, setOpen] = useState<OpenIssue | null>(null)
  const [showErrors, setShowErrors] = useState(true)
  const [showWarns, setShowWarns] = useState(true)

  const levels = [...(showErrors ? ['error'] : []), ...(showWarns ? ['warn'] : [])]
  const { data, loading, error } = useDashboard(hours, levels)

  const periodStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const isNew = (issue: Issue) => issue.firstSeen >= periodStart

  const maxBarValue = data ? Math.max(...data.byHour.map((h) => h.errors + h.warns), 1) : 1

  const maxCodeCount = data?.topCodes[0]?.count ?? 1

  // Show x-axis labels at roughly 6 evenly spaced positions
  const xLabelIndices = (byHour: { hour: string; errors: number; warns: number }[]) => {
    const len = byHour.length
    const step = Math.ceil(len / 5)
    const indices = new Set<number>()
    for (let i = 0; i < len; i += step) indices.add(i)
    indices.add(len - 1)
    return indices
  }

  const levelPills = (
    <div className="level-filter-pills">
      <button
        className={`level-pill level-pill-error${showErrors ? ' active' : ''}`}
        onClick={() => setShowErrors((v) => !v)}
      >
        Errors
      </button>
      <button
        className={`level-pill level-pill-warn${showWarns ? ' active' : ''}`}
        onClick={() => setShowWarns((v) => !v)}
      >
        Warnings
      </button>
    </div>
  )

  const controls = (
    <select
      value={hours}
      onChange={(e) => setHours(Number(e.target.value))}
      className="form-select form-select-sm"
      style={{ width: 'auto' }}
    >
      <option value={24}>Last 24 hours</option>
      <option value={48}>Last 48 hours</option>
      <option value={72}>Last 72 hours</option>
    </select>
  )

  return (
    <div className="App" data-bs-theme="dark">
      <Header controls={controls} />

      <div className="main-content dashboard-content">
        {loading && !data && (
          <div className="dashboard-empty">
            <div className="spinner-border spinner-border-sm text-secondary me-2" role="status" />
            Loading...
          </div>
        )}

        {error && <div className="alert alert-danger m-3">{error}</div>}

        {data && (
          <>
            {/* ── Stat cards ─────────────────────────────────────────── */}
            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="stat-card stat-errors">
                  <div className="stat-value text-danger">{data.totals.errors}</div>
                  <div className="stat-label">Errors</div>
                </div>
              </div>
              <div className="col-6 col-md-3">
                <div className="stat-card stat-warns">
                  <div className="stat-value text-warning">{data.totals.warns}</div>
                  <div className="stat-label">Warnings</div>
                </div>
              </div>
              <div className="col-6 col-md-3">
                <div className="stat-card stat-apps">
                  <div className="stat-value text-info">{data.byApp.length}</div>
                  <div className="stat-label">Apps reporting</div>
                </div>
              </div>
              <div className="col-6 col-md-3">
                <div className="stat-card stat-topcode">
                  <div className="stat-value" style={{ color: '#a78bfa' }}>
                    {data.issues.length >= 50 ? '50+' : data.issues.length}
                  </div>
                  <div className="stat-label">Issues ({data.issues.filter(isNew).length} new)</div>
                </div>
              </div>
            </div>

            {/* ── Issues ──────────────────────────────────────────────── */}
            <div className="panel-card mb-3">
              <div className="panel-title-row">
                <span className="panel-title">Issues</span>
                {levelPills}
              </div>
              {data.issues.length === 0 ? (
                <div className="dashboard-empty" style={{ padding: '1.5rem' }}>
                  No issues in this period
                </div>
              ) : (
                data.issues.map((issue) => (
                  <div
                    key={issue.fingerprint}
                    className="issue-row"
                    onClick={() => setOpen({ fingerprint: issue.fingerprint })}
                  >
                    <span
                      className={`issue-level ${issue.level === 'warn' ? 'issue-level-warn' : 'issue-level-error'}`}
                    />
                    <div className="issue-main">
                      <div className="issue-msg">
                        {isNew(issue) && <span className="issue-new">New</span>}
                        {issue.msg}
                      </div>
                      <div className="issue-meta">
                        <span className="issue-app">{issue.app}</span>
                        {issue.route && (
                          <span>
                            {issue.method} {issue.route}
                          </span>
                        )}
                        {issue.status != null && <span>{issue.status}</span>}
                        {issue.code && <span className="issue-code">{issue.code}</span>}
                      </div>
                    </div>
                    <div className="issue-stat">
                      <div className="issue-stat-value">{issue.count}</div>
                      <div className="issue-stat-label">events</div>
                    </div>
                    <div className="issue-stat">
                      <div className="issue-stat-value">{issue.users || '—'}</div>
                      <div className="issue-stat-label">users</div>
                    </div>
                    <div className="issue-stat issue-stat-wide">
                      <div className="issue-stat-value">{timeAgo(issue.lastSeen)}</div>
                      <div className="issue-stat-label">last seen</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── Hourly bar chart ────────────────────────────────────── */}
            <div className="chart-card mb-3">
              <h6>Errors &amp; warnings by hour</h6>
              {data.byHour.every((h) => h.errors === 0 && h.warns === 0) ? (
                <div className="dashboard-empty" style={{ padding: '1.5rem' }}>
                  No errors or warnings in this period
                </div>
              ) : (
                <>
                  <div className="bar-chart">
                    {data.byHour.map((bucket, i) => {
                      const total = bucket.errors + bucket.warns
                      const totalPct = (total / maxBarValue) * 100
                      const errorPct = total > 0 ? (bucket.errors / total) * 100 : 0
                      const warnPct = 100 - errorPct
                      return (
                        <div key={i} className="bar-col">
                          <div className="bar-tooltip">
                            {formatHourLabel(bucket.hour)}
                            <br />
                            {bucket.errors > 0 && (
                              <>
                                {bucket.errors} error{bucket.errors !== 1 ? 's' : ''}
                                <br />
                              </>
                            )}
                            {bucket.warns > 0 && (
                              <>
                                {bucket.warns} warning{bucket.warns !== 1 ? 's' : ''}
                              </>
                            )}
                          </div>
                          {total > 0 && (
                            <div
                              style={{
                                height: `${totalPct}%`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'flex-end',
                              }}
                            >
                              {bucket.errors > 0 && (
                                <div
                                  className="bar-segment-error"
                                  style={{ height: `${errorPct}%` }}
                                />
                              )}
                              {bucket.warns > 0 && (
                                <div
                                  className="bar-segment-warn"
                                  style={{ height: `${warnPct}%` }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="bar-x-labels">
                    {data.byHour.map((bucket, i) => (
                      <span
                        key={i}
                        style={{
                          visibility: xLabelIndices(data.byHour).has(i) ? 'visible' : 'hidden',
                        }}
                      >
                        {formatHourLabel(bucket.hour)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ── Bottom panels ───────────────────────────────────────── */}
            <div className="row g-3">
              {/* Errors by app */}
              <div className="col-12 col-lg-4">
                <div className="panel-card">
                  <div className="panel-title">By app</div>
                  {data.byApp.length === 0 ? (
                    <div className="dashboard-empty">No data</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>App</th>
                          <th>Errors</th>
                          <th>Warns</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byApp.map((row) => (
                          <tr key={row.app}>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                              {row.app}
                            </td>
                            <td className="text-danger fw-semibold">{row.errors || '—'}</td>
                            <td className="text-warning">{row.warns || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Top error codes */}
              <div className="col-12 col-lg-4">
                <div className="panel-card">
                  <div className="panel-title">Top error codes</div>
                  {data.topCodes.length === 0 ? (
                    <div className="dashboard-empty">No error codes recorded</div>
                  ) : (
                    data.topCodes.map((row) => (
                      <div key={row.code} className="code-bar-row">
                        <div className="code-name">{row.code}</div>
                        <div className="code-track">
                          <div
                            className="code-fill"
                            style={{ width: `${(row.count / maxCodeCount) * 100}%` }}
                          />
                        </div>
                        <div className="code-count">{row.count}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent errors & warnings */}
              <div className="col-12 col-lg-4">
                <div className="panel-card">
                  <div className="panel-title-row">
                    <span className="panel-title">Recent errors &amp; warnings</span>
                  </div>
                  {data.recentErrors.length === 0 ? (
                    <div className="dashboard-empty">
                      No {!showErrors ? 'warnings' : !showWarns ? 'errors' : 'errors or warnings'}{' '}
                      in this period
                    </div>
                  ) : (
                    data.recentErrors.map((err) => (
                      <div
                        key={err.id}
                        className="error-row error-row-clickable"
                        onClick={() =>
                          err.fingerprint && setOpen({ fingerprint: err.fingerprint, focus: err })
                        }
                      >
                        <span
                          className={`err-level-badge ${err.level === 'warn' ? 'err-level-warn' : 'err-level-error'}`}
                        >
                          {err.level === 'warn' ? 'W' : 'E'}
                        </span>
                        <span className="err-time">{formatTime(err.ts)}</span>
                        <span className="err-app">{err.app}</span>
                        {err.code && <span className="err-code">{err.code}</span>}
                        <span className="err-msg">{err.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {data && data.totals.errors === 0 && data.totals.warns === 0 && !loading && (
          <div className="dashboard-empty mt-4">
            No structured events in the last {hours} hours.
            <br />
            <small>
              Only events sent via the logtrail middleware appear here. Plain text agent logs are
              visible in the Logs view.
            </small>
          </div>
        )}
      </div>

      <IssueModal open={open} isNew={isNew} onHide={() => setOpen(null)} />
    </div>
  )
}

function IssueModal({
  open,
  isNew,
  onHide,
}: {
  open: OpenIssue | null
  isNew: (issue: Issue) => boolean
  onHide: () => void
}) {
  const { issue, loading, error } = useIssue(open?.fingerprint ?? null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lastOpen, setLastOpen] = useState(open)

  // Reset the selection whenever a different issue or occurrence is opened
  if (open !== lastOpen) {
    setLastOpen(open)
    setSelectedId(open?.focus?.id ?? null)
  }

  const events = issue?.events ?? []
  const selected: EventDetail | undefined =
    events.find((e) => e.id === selectedId) ??
    (open?.focus && open.focus.id === selectedId ? open.focus : undefined) ??
    events[0] ??
    open?.focus

  return (
    <Modal show={!!open} onHide={onHide} size="lg" centered data-bs-theme="dark">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2" style={{ fontSize: '1rem' }}>
          {(issue?.level ?? open?.focus?.level) === 'warn' ? (
            <span className="badge bg-warning text-dark">WARN</span>
          ) : (
            <span className="badge bg-danger">ERROR</span>
          )}
          {issue && isNew(issue) && <span className="badge bg-info text-dark">NEW</span>}
          {issue?.code && (
            <span
              className="badge"
              style={{ background: 'rgba(111,66,193,0.4)', color: '#a78bfa' }}
            >
              {issue.code}
            </span>
          )}
          <span className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {issue?.app ?? open?.focus?.app}
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
        {error && <div className="alert alert-danger">{error}</div>}

        {issue && (
          <div className="row g-2 mb-3 issue-summary">
            <DetailField label="Events" value={String(issue.count)} />
            <DetailField label="Users" value={issue.users ? String(issue.users) : '—'} />
            <DetailField label="First seen" value={new Date(issue.firstSeen).toLocaleString()} />
            <DetailField label="Last seen" value={new Date(issue.lastSeen).toLocaleString()} />
            {issue.route && (
              <DetailField label="Route" value={`${issue.method ?? ''} ${issue.route}`.trim()} />
            )}
            {issue.releases.length > 0 && (
              <DetailField label="Releases" value={issue.releases.join(', ')} />
            )}
          </div>
        )}

        {events.length > 1 && (
          <>
            <SectionLabel>Occurrences</SectionLabel>
            <div className="occurrence-list mb-3">
              {events.map((e) => (
                <div
                  key={e.id}
                  className={`occurrence-row${e.id === selected?.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <span className="occ-time">{new Date(e.ts).toLocaleString()}</span>
                  {e.path && <span className="occ-path">{e.path}</span>}
                  {e.userId != null && <span className="occ-user">user {String(e.userId)}</span>}
                  {e.reqId && <span className="occ-req">{e.reqId}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {loading && !selected && (
          <div className="text-secondary">
            <div className="spinner-border spinner-border-sm me-2" role="status" />
            Loading...
          </div>
        )}

        {selected && <EventDetails event={selected} />}
      </Modal.Body>
    </Modal>
  )
}

const KNOWN_FIELDS = new Set([
  'id',
  'fingerprint',
  'ts',
  'app',
  'level',
  'msg',
  'code',
  'method',
  'path',
  'route',
  'status',
  'duration',
  'reqId',
  'userId',
  'release',
  'stack',
])

function EventDetails({ event }: { event: EventDetail }) {
  const extra = Object.entries(event).filter(([k, v]) => !KNOWN_FIELDS.has(k) && v != null)

  return (
    <>
      {/* Message */}
      <div className="mb-3" style={{ color: '#f8f9fa', fontSize: '0.95rem' }}>
        {event.msg}
      </div>

      {/* Metadata grid */}
      <div className="row g-2 mb-3">
        <DetailField label="Time" value={new Date(event.ts).toLocaleString()} />
        <DetailField label="App" value={event.app} />
        {event.method && event.path && (
          <DetailField label="Request" value={`${event.method} ${event.path}`} />
        )}
        {event.status != null && <DetailField label="Status" value={String(event.status)} />}
        {event.duration != null && <DetailField label="Duration" value={`${event.duration}ms`} />}
        {event.reqId && <DetailField label="Request ID" value={event.reqId} />}
        {event.userId != null && <DetailField label="User ID" value={String(event.userId)} />}
        {event.release && <DetailField label="Release" value={event.release} />}
        {extra.map(([k, v]) => (
          <DetailField key={k} label={k} value={typeof v === 'string' ? v : JSON.stringify(v)} />
        ))}
      </div>

      {/* Stack trace */}
      {event.stack && (
        <>
          <SectionLabel>Stack trace</SectionLabel>
          <pre className="stack-trace">{event.stack}</pre>
        </>
      )}
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-secondary mb-1"
      style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}
    >
      {children}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-6">
      <div
        style={{
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#6c757d',
          marginBottom: '2px',
        }}
      >
        {label}
      </div>
      <div style={{ color: '#f8f9fa', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}
