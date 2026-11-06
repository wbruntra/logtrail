import type { IssueState, IssueSummary, Window } from '@shared/api-types.ts'
import { useState } from 'preact/hooks'
import { setIssueState } from '../lib/api'
import { num, plural } from '../lib/format'
import { issueHref, Link, rowLink } from '../lib/router'
import { ERROR_COLOR, Spark, WARN_COLOR } from './charts'
import { Ago, Card, Empty, ErrorBox, LevelBadge, Route } from './ui'

type LevelFilter = 'all' | 'error' | 'warn'
type Sort = 'recent' | 'count' | 'new'

const SORTS: Record<Sort, (a: IssueSummary, b: IssueSummary) => number> = {
  recent: (a, b) => b.lastSeen.localeCompare(a.lastSeen),
  count: (a, b) => b.count - a.count,
  new: (a, b) => b.firstSeen.localeCompare(a.firstSeen),
}

const TABS: { state: IssueState; label: string; empty: string }[] = [
  { state: 'open', label: 'Open', empty: 'No open issues in this window 🎉' },
  { state: 'resolved', label: 'Resolved', empty: 'No resolved issues seen in this window' },
  { state: 'muted', label: 'Muted', empty: 'No muted issues seen in this window' },
]

/** What can be done to issues in each tab */
const ACTIONS: Record<IssueState, { to: IssueState; label: string }[]> = {
  open: [
    { to: 'resolved', label: 'Resolve' },
    { to: 'muted', label: 'Mute' },
  ],
  resolved: [
    { to: 'open', label: 'Reopen' },
    { to: 'muted', label: 'Mute' },
  ],
  muted: [{ to: 'open', label: 'Unmute' }],
}

export function IssuesCard({
  issues,
  window,
  onChanged,
}: {
  issues: IssueSummary[]
  window: Window
  /** Called after issues are resolved, muted or reopened */
  onChanged: () => void
}) {
  // Name the service only where issues of several services are listed together
  const showService = new Set(issues.map((i) => i.service)).size > 1
  const [tab, setTab] = useState<IssueState>('open')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const inTab = issues.filter((i) => i.state === tab)
  const shown = inTab.filter((i) => level === 'all' || i.level === level).sort(SORTS[sort])
  // Only act on what is visible: a selection hidden by a filter stays put
  const chosen = shown.filter((i) => selected.has(i.fingerprint)).map((i) => i.fingerprint)
  const allChosen = shown.length > 0 && chosen.length === shown.length

  const switchTab = (state: IssueState) => {
    setTab(state)
    setSelected(new Set())
  }
  const toggle = (fp: string) => {
    const next = new Set(selected)
    if (next.has(fp)) next.delete(fp)
    else next.add(fp)
    setSelected(next)
  }
  const apply = async (to: IssueState) => {
    setBusy(true)
    setError(null)
    try {
      await setIssueState(chosen, to)
      setSelected(new Set())
      onChanged()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Issues"
      flush
      actions={
        <>
          <div class="segmented small" role="group" aria-label="Issue state">
            {TABS.map((t) => (
              <button
                key={t.state}
                type="button"
                aria-pressed={tab === t.state}
                onClick={() => switchTab(t.state)}
              >
                {t.label} {issues.filter((i) => i.state === t.state).length}
              </button>
            ))}
          </div>
          <select
            class="select small"
            value={level}
            aria-label="Level"
            onChange={(e) => setLevel(e.currentTarget.value as LevelFilter)}
          >
            <option value="all">All levels</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
          </select>
          <select
            class="select small"
            value={sort}
            aria-label="Sort issues"
            onChange={(e) => setSort(e.currentTarget.value as Sort)}
          >
            <option value="recent">Last seen</option>
            <option value="count">Most frequent</option>
            <option value="new">Newest</option>
          </select>
        </>
      }
    >
      {chosen.length > 0 && (
        <div class="bulk-bar">
          <span>{plural(chosen.length, 'issue')} selected</span>
          {ACTIONS[tab].map((a) => (
            <button
              key={a.to}
              type="button"
              class="btn small"
              disabled={busy}
              onClick={() => apply(a.to)}
            >
              {a.label}
            </button>
          ))}
          <button type="button" class="btn ghost small" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {shown.length ? (
        <table class="table rows-link issues">
          <thead>
            <tr>
              <th class="check">
                <input
                  type="checkbox"
                  aria-label="Select all shown issues"
                  checked={allChosen}
                  onChange={() =>
                    setSelected(allChosen ? new Set() : new Set(shown.map((i) => i.fingerprint)))
                  }
                />
              </th>
              <th>Issue</th>
              <th class="hide-sm">Trend</th>
              <th class="num">Events</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr
                key={i.fingerprint}
                class={selected.has(i.fingerprint) ? 'selected' : ''}
                onClick={rowLink(issueHref(i.fingerprint))}
              >
                <td class="check">
                  <input
                    type="checkbox"
                    aria-label="Select issue"
                    checked={selected.has(i.fingerprint)}
                    onChange={() => toggle(i.fingerprint)}
                  />
                </td>
                <td class="issue-main">
                  <div class="issue-title">
                    <LevelBadge level={i.level} />
                    <Link class="row-title truncate" href={issueHref(i.fingerprint)} title={i.msg}>
                      {i.msg}
                    </Link>
                  </div>
                  <div class="row-sub muted">
                    {showService && <span class="badge">{i.service}</span>}
                    <Route method={i.method} route={i.route} />
                    {i.code && <code class="code">{i.code}</code>}
                    {i.status && <span class={`status s${String(i.status)[0]}`}>{i.status}</span>}
                    {i.regressed && <span class="badge regressed">Regressed</span>}
                    {i.isNew && !i.regressed && <span class="badge new">New</span>}
                  </div>
                </td>
                <td class="hide-sm">
                  <Spark
                    window={window}
                    series={[
                      {
                        key: 'n',
                        label: 'Occurrences',
                        color: i.level === 'error' ? ERROR_COLOR : WARN_COLOR,
                        values: i.series,
                      },
                    ]}
                  />
                </td>
                <td class="num">
                  <div>{num(i.count)}</div>
                  <div class="row-sub muted">{i.users ? plural(i.users, 'user') : ''}</div>
                </td>
                <td class="when">
                  <Ago ts={i.lastSeen} />
                  <div class="when-sub muted">
                    first <Ago ts={i.firstSeen} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>
          {inTab.length ? 'No issues at this level' : TABS.find((t) => t.state === tab)!.empty}
        </Empty>
      )}
    </Card>
  )
}
