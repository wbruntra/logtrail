import { useState } from 'react'
import { Modal } from 'react-bootstrap'
import { useDashboard, type RecentError } from '../hooks/useDashboard'
import Header from './Header'
import '../styles/dashboard.css'

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  } catch {
    return isoStr.slice(11, 16)
  }
}

function formatHourLabel(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  } catch {
    return isoStr.slice(11, 16)
  }
}

export default function Dashboard() {
  const [hours, setHours] = useState(24)
  const [selected, setSelected] = useState<RecentError | null>(null)
  const { data, loading, error } = useDashboard(hours)

  const maxBarValue = data
    ? Math.max(...data.byHour.map((h) => h.errors + h.warns), 1)
    : 1

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
        {loading && (
          <div className="dashboard-empty">
            <div className="spinner-border spinner-border-sm text-secondary me-2" role="status" />
            Loading...
          </div>
        )}

        {error && (
          <div className="alert alert-danger m-3">{error}</div>
        )}

        {data && !loading && (
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
                  {data.topCodes[0] ? (
                    <>
                      <div className="stat-value" style={{ color: '#a78bfa', fontSize: '1.25rem' }}>
                        {data.topCodes[0].code}
                      </div>
                      <div className="stat-label">Top error code ({data.topCodes[0].count}×)</div>
                    </>
                  ) : (
                    <>
                      <div className="stat-value text-secondary">—</div>
                      <div className="stat-label">Top error code</div>
                    </>
                  )}
                </div>
              </div>
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
                            {formatHourLabel(bucket.hour)}<br />
                            {bucket.errors > 0 && <>{bucket.errors} error{bucket.errors !== 1 ? 's' : ''}<br /></>}
                            {bucket.warns > 0 && <>{bucket.warns} warning{bucket.warns !== 1 ? 's' : ''}</>}
                          </div>
                          {total > 0 && (
                            <div style={{ height: `${totalPct}%`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                              {bucket.errors > 0 && (
                                <div className="bar-segment-error" style={{ height: `${errorPct}%` }} />
                              )}
                              {bucket.warns > 0 && (
                                <div className="bar-segment-warn" style={{ height: `${warnPct}%` }} />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="bar-x-labels">
                    {data.byHour.map((bucket, i) => (
                      <span key={i} style={{ visibility: xLabelIndices(data.byHour).has(i) ? 'visible' : 'hidden' }}>
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
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{row.app}</td>
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

              {/* Recent errors */}
              <div className="col-12 col-lg-4">
                <div className="panel-card">
                  <div className="panel-title">Recent errors</div>
                  {data.recentErrors.length === 0 ? (
                    <div className="dashboard-empty">No errors in this period</div>
                  ) : (
                    data.recentErrors.map((err, i) => (
                      <div key={i} className="error-row error-row-clickable" onClick={() => setSelected(err)}>
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
            No structured events in the last {hours} hours.<br />
            <small>Only events sent via logtrail-middleware appear here. Plain text agent logs are visible in the Logs view.</small>
          </div>
        )}
      </div>

      {/* ── Error detail modal ──────────────────────────────────────── */}
      <Modal
        show={!!selected}
        onHide={() => setSelected(null)}
        size="lg"
        centered
        data-bs-theme="dark"
      >
        {selected && (
          <>
            <Modal.Header closeButton>
              <Modal.Title className="d-flex align-items-center gap-2" style={{ fontSize: '1rem' }}>
                <span className="badge bg-danger">ERROR</span>
                {selected.code && (
                  <span className="badge" style={{ background: 'rgba(111,66,193,0.4)', color: '#a78bfa' }}>
                    {selected.code}
                  </span>
                )}
                <span className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {selected.app}
                </span>
              </Modal.Title>
            </Modal.Header>
            <Modal.Body style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {/* Message */}
              <div className="mb-3" style={{ color: '#f8f9fa', fontSize: '0.95rem' }}>
                {selected.msg}
              </div>

              {/* Metadata grid */}
              <div className="row g-2 mb-3">
                <DetailField label="Time" value={new Date(selected.ts).toLocaleString()} />
                <DetailField label="App" value={selected.app} />
                {selected.method && selected.path && (
                  <DetailField label="Request" value={`${selected.method} ${selected.path}`} />
                )}
                {selected.status != null && (
                  <DetailField label="Status" value={String(selected.status)} />
                )}
                {selected.duration != null && (
                  <DetailField label="Duration" value={`${selected.duration}ms`} />
                )}
                {selected.reqId && (
                  <DetailField label="Request ID" value={selected.reqId} />
                )}
                {selected.userId != null && (
                  <DetailField label="User ID" value={String(selected.userId)} />
                )}
              </div>

              {/* Stack trace */}
              {selected.stack && (
                <>
                  <div className="text-secondary mb-1" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Stack trace
                  </div>
                  <pre style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#f8d7da',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    margin: 0,
                  }}>
                    {selected.stack}
                  </pre>
                </>
              )}
            </Modal.Body>
          </>
        )}
      </Modal>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-6">
      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6c757d', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ color: '#f8f9fa' }}>{value}</div>
    </div>
  )
}
