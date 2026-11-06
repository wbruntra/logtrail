import type { Level, Overview } from '@shared/api-types.ts'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { type Resource, useApi } from '../lib/api'
import { ago, fullTime } from '../lib/format'
import { Link } from '../lib/router'
import { ALL_ENVS, setEnv, setHours, useHours, useSelectedEnv, WINDOWS } from '../lib/settings'

const LEVEL_LABEL: Record<Level | 'none', string> = {
  error: 'Error',
  warn: 'Warn',
  info: 'Info',
  debug: 'Debug',
  success: 'OK',
  none: 'Raw',
}

/** Level as text plus a shape-coded dot, so it never relies on color alone. */
export function LevelBadge({ level }: { level: Level | null }) {
  const key = level ?? 'none'
  return <span class={`level level-${key}`}>{LEVEL_LABEL[key]}</span>
}

/** Re-renders every 30s so relative times stay current. */
function useNow(interval = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

export function Ago({ ts, fallback = 'never' }: { ts: string | null; fallback?: string }) {
  const now = useNow()
  if (!ts) return <span class="muted">{fallback}</span>
  return (
    <time dateTime={ts} title={fullTime(ts)}>
      {ago(ts, now)}
    </time>
  )
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: ComponentChildren
  tone?: 'critical' | 'warning'
  hint?: ComponentChildren
}) {
  return (
    <div class="stat">
      <div class="stat-label">
        {tone && <span class={`stat-dot ${tone}`} aria-hidden="true" />}
        {label}
      </div>
      <div class="stat-value">{value}</div>
      {hint && <div class="stat-hint">{hint}</div>}
    </div>
  )
}

export function Card({
  title,
  actions,
  children,
  flush,
}: {
  title?: ComponentChildren
  actions?: ComponentChildren
  children: ComponentChildren
  /** No body padding, for tables */
  flush?: boolean
}) {
  return (
    <section class="card">
      {(title || actions) && (
        <header class="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div class="card-actions">{actions}</div>}
        </header>
      )}
      <div class={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function WindowPicker() {
  const hours = useHours()
  return (
    <div class="segmented" role="group" aria-label="Time window">
      {WINDOWS.map((w) => (
        <button
          key={w.hours}
          type="button"
          aria-pressed={hours === w.hours}
          onClick={() => setHours(w.hours)}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

/** Switches the environment every view shows; hidden while there is only one. */
export function EnvPicker() {
  const envs = useApi<Overview>('/api/apps?hours=1').data?.envs ?? []
  const selected = useSelectedEnv()
  if (envs.length < 2) return null
  return (
    <select
      class="select"
      aria-label="Environment"
      value={selected}
      onChange={(e) => setEnv(e.currentTarget.value)}
    >
      {envs.map((env) => (
        <option key={env} value={env}>
          {env}
        </option>
      ))}
      <option value={ALL_ENVS}>all environments</option>
    </select>
  )
}

export function Crumbs({ items }: { items: { label: ComponentChildren; href?: string }[] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span class="crumb-sep">/</span>}
          {item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/**
 * Renders a resource's data, or its loading/error state the first time.
 * Later refetch errors show as a banner above the stale data.
 */
export function Loaded<T>({
  resource,
  children,
}: {
  resource: Resource<T>
  children: (data: T) => ComponentChildren
}) {
  const { data, error, loading } = resource
  if (data === null) {
    if (error) return <ErrorBox error={error} retry={resource.reload} />
    if (loading) return <div class="loading">Loading…</div>
    return null
  }
  return (
    <>
      {error && <ErrorBox error={error} retry={resource.reload} stale />}
      {children(data)}
    </>
  )
}

export function ErrorBox({
  error,
  retry,
  stale,
}: {
  error: Error
  retry?: () => void
  stale?: boolean
}) {
  return (
    <div class="error-box" role="alert">
      <span>
        {stale ? 'Refresh failed: ' : ''}
        {error.message}
      </span>
      {retry && (
        <button type="button" class="btn small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>
}

/** "/orders/:id" with a method chip, for routes and request lines */
export function Route({ method, route }: { method: string | null; route: string | null }) {
  if (!method && !route) return null
  return (
    <span class="route">
      {method && <span class="method">{method}</span>}
      {route}
    </span>
  )
}

/** Stack trace with the app's own frames emphasized and library frames dimmed. */
export function StackTrace({ stack }: { stack: string }) {
  const lines = stack.split('\n')
  return (
    <pre class="stack">
      {lines.map((line, i) => {
        const t = line.trim()
        const frame = t.startsWith('at ')
        const lib = frame && /node_modules|\(node:|at node:|\(native\)/.test(t)
        const cls = i === 0 ? 'stack-head' : frame ? (lib ? 'stack-lib' : 'stack-app') : ''
        return (
          <span key={i} class={cls}>
            {line}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}
