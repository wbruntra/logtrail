import type { AnchorHTMLAttributes, ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'

// A minimal history-API router: the URL is the state, so every view is linkable.

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())
window.addEventListener('popstate', notify)

export function navigate(href: string, { replace = false } = {}) {
  if (href === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', href)
  if (!replace) window.scrollTo(0, 0)
  notify()
}

export interface Location {
  path: string
  query: URLSearchParams
}

export function useLocation(): Location {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((n) => n + 1)
    listeners.add(fn)
    return () => void listeners.delete(fn)
  }, [])
  return { path: location.pathname, query: new URLSearchParams(location.search) }
}

/** Replace some query params in the current URL; empty values are removed. */
export function setQuery(params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams(location.search)
  for (const [k, v] of Object.entries(params)) {
    if (v) query.set(k, v)
    else query.delete(k)
  }
  const qs = query.toString()
  navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: true })
}

/** Match "/apps/:app" against a path; params are URL-decoded. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/')
  const s = path.replace(/\/$/, '').split('/')
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i])
    else if (p[i] !== s[i]) return null
  }
  return params
}

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: ComponentChildren
}

/** An <a> that navigates in-app, leaving modified clicks (new tab etc.) to the browser. */
export function Link({ href, onClick, ...props }: AnchorProps) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}

export const appHref = (app: string) => `/apps/${encodeURIComponent(app)}`
export const issueHref = (fingerprint: string) => `/issues/${fingerprint}`
export const eventHref = (id: number) => `/events/${id}`
export function eventsHref(params: { app?: string; levels?: string; q?: string; reqId?: string }) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v)
  const qs = query.toString()
  return `/events${qs ? `?${qs}` : ''}`
}

/** Click handler for a table row that navigates, deferring to links inside it and text selection. */
export function rowLink(href: string) {
  return (e: MouseEvent) => {
    if ((e.target as Element).closest('a, button, input, select')) return
    if (window.getSelection()?.toString()) return
    if (e.metaKey || e.ctrlKey) window.open(href, '_blank')
    else navigate(href)
  }
}
