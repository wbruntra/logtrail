import type { Breakdown, Series, Window } from '@shared/api-types.ts'
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { bucketLabel, bucketRange, num } from '../lib/format'

export interface ChartSeries {
  key: string
  label: string
  /** CSS color, normally a var(--…) token */
  color: string
  values: Series
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** 1-2-5 steps: a clean top value at or above max */
function niceMax(max: number): number {
  if (max <= 4) return Math.max(max, 1)
  const mag = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= max) return step * mag
  return 10 * mag
}

/** A column segment with a rounded top (the data end) and a square base. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function Legend({ series }: { series: Pick<ChartSeries, 'key' | 'label' | 'color'>[] }) {
  return (
    <div class="legend">
      {series.map((s) => (
        <span key={s.key} class="legend-item">
          <span class="swatch" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

const GAP = 2
const AXIS_W = 36
const AXIS_H = 20
// Room above the top gridline for its tick label
const PAD_TOP = 8

/**
 * Stacked columns, one per window bucket, first series at the baseline.
 * Hovering a column shows its time range and per-series counts.
 */
export function StackedColumns({
  window,
  series,
  height = 180,
  empty = 'Nothing in this window',
}: {
  window: Window
  series: ChartSeries[]
  height?: number
  empty?: ComponentChildren
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = window.buckets.length
  const totals = window.buckets.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  const max = niceMax(Math.max(0, ...totals))
  const plotW = Math.max(0, width - AXIS_W)
  const plotH = height - AXIS_H - PAD_TOP
  const slot = n ? plotW / n : 0
  const barW = Math.max(1, Math.min(24, slot - GAP))
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH
  const ticks = max <= 4 ? [0, max] : [0, max / 2, max]
  // Aim for a label roughly every 80px
  const labelEvery = Math.max(1, Math.ceil(80 / Math.max(slot, 1)))
  const allZero = totals.every((t) => t === 0)

  return (
    <div class="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={series.map((s) => s.label).join(' and ') + ' over time'}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line class="grid" x1={AXIS_W} x2={width} y1={y(t) + 0.5} y2={y(t) + 0.5} />
              <text class="tick" x={AXIS_W - 8} y={y(t)} dy="0.32em" text-anchor="end">
                {num(t)}
              </text>
            </g>
          ))}
          {window.buckets.map((b, i) => {
            const x = AXIS_W + i * slot + (slot - barW) / 2
            let base = PAD_TOP + plotH
            const top = series.findLastIndex((s) => s.values[i] > 0)
            return (
              <g key={b} class={hover === i ? 'col hover' : 'col'}>
                {series.map((s, si) => {
                  const v = s.values[i]
                  if (!v) return null
                  const h = Math.max(1, (v / max) * plotH)
                  // The gap comes out of the segment below, so totals keep their height
                  const gap = si < top ? GAP : 0
                  base -= h
                  return (
                    <path
                      key={s.key}
                      d={columnPath(x, base, barW, Math.max(0.5, h - gap), si === top)}
                      transform={gap ? `translate(0 ${gap})` : undefined}
                      fill={s.color}
                    />
                  )
                })}
                {i % labelEvery === 0 && (
                  <text class="tick" x={x + barW / 2} y={height - 4} text-anchor="middle">
                    {bucketLabel(b, window.bucketMs)}
                  </text>
                )}
                <rect
                  class="hit"
                  x={AXIS_W + i * slot}
                  y={0}
                  width={slot}
                  height={PAD_TOP + plotH}
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            )
          })}
          <line
            class="baseline"
            x1={AXIS_W}
            x2={width}
            y1={PAD_TOP + plotH + 0.5}
            y2={PAD_TOP + plotH + 0.5}
          />
        </svg>
      )}
      {allZero && width > 0 && <div class="chart-empty">{empty}</div>}
      {hover !== null && width > 0 && (
        <div
          class="tooltip"
          style={{
            left: `${Math.min(Math.max(AXIS_W + hover * slot + slot / 2, 90), width - 90)}px`,
          }}
        >
          <div class="tooltip-title">{bucketRange(window.buckets[hover], window.bucketMs)}</div>
          {[...series].reverse().map((s) => (
            <div key={s.key} class="tooltip-row">
              <span class="swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span class="tooltip-value">{num(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A tiny stacked column chart for table rows. Same encoding as StackedColumns,
 * scaled to its own max; exact counts are in the row and the bar titles.
 */
export function Spark({
  window,
  series,
  height = 24,
}: {
  window: Window
  series: ChartSeries[]
  height?: number
}) {
  const n = window.buckets.length
  const bar = n > 40 ? 2 : 3
  const step = bar + 1
  const totals = window.buckets.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  const max = Math.max(1, ...totals)
  return (
    <svg class="spark" width={n * step} height={height} aria-hidden="true">
      {window.buckets.map((b, i) => {
        let base = height
        return (
          <g key={b}>
            <rect class="spark-track" x={i * step} y={height - 1} width={bar} height={1} />
            {series.map((s) => {
              const v = s.values[i]
              if (!v) return null
              const h = Math.max(2, (v / max) * height)
              base -= h
              return (
                <rect key={s.key} x={i * step} y={base} width={bar} height={h} fill={s.color} />
              )
            })}
            {totals[i] > 0 && (
              <title>
                {bucketRange(b, window.bucketMs)}:{' '}
                {series.map((s) => `${num(s.values[i])} ${s.label.toLowerCase()}`).join(', ')}
              </title>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Horizontal bars for a ranked breakdown, values at the bar ends. */
export function BarList({
  items,
  label = (v) => v,
  href,
  empty = 'None recorded',
}: {
  items: Breakdown[]
  label?: (value: string) => ComponentChildren
  href?: (value: string) => string
  empty?: string
}) {
  if (!items.length) return <p class="muted small">{empty}</p>
  const max = Math.max(...items.map((i) => i.count))
  return (
    <ul class="barlist">
      {items.map((item) => {
        const content = (
          <>
            <span class="barlist-label" title={item.value}>
              {label(item.value)}
            </span>
            <span class="barlist-track">
              <span class="barlist-bar" style={{ width: `${(item.count / max) * 100}%` }} />
            </span>
            <span class="barlist-value">{num(item.count)}</span>
          </>
        )
        return (
          <li key={item.value}>
            {href ? (
              <a class="barlist-row" href={href(item.value)}>
                {content}
              </a>
            ) : (
              <div class="barlist-row">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export const ERROR_COLOR = 'var(--status-critical)'
export const WARN_COLOR = 'var(--status-warning)'
export const VOLUME_COLOR = 'var(--series-1)'

/** The standard errors-then-warnings stack */
export function alertSeries(errors: Series, warns: Series): ChartSeries[] {
  return [
    { key: 'errors', label: 'Errors', color: ERROR_COLOR, values: errors },
    { key: 'warns', label: 'Warnings', color: WARN_COLOR, values: warns },
  ]
}
