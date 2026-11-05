// Raw lines from the agent often carry terminal color codes (e.g. morgan's
// colored status). Render the SGR color codes as theme colors; drop the rest.

// ESC [ params m, plus a bare "[0m" whose ESC was lost before ingest
const SGR = /\x1b\[([\d;]*)m|\[(\d{1,2}(?:;\d{1,2})*)m/g
const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

interface Style {
  color: string | null
  bold: boolean
  dim: boolean
}

function apply(style: Style, params: string): Style {
  const next = { ...style }
  for (const code of (params || '0').split(';').map(Number)) {
    if (code === 0) Object.assign(next, { color: null, bold: false, dim: false })
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 22) Object.assign(next, { bold: false, dim: false })
    else if (code === 39) next.color = null
    else if (code >= 30 && code <= 37) next.color = COLORS[code - 30]
    else if (code >= 90 && code <= 97) next.color = COLORS[code - 90]
  }
  return next
}

export function hasAnsi(text: string) {
  SGR.lastIndex = 0
  return SGR.test(text)
}

/** Text with ANSI color codes rendered as spans. */
export function Ansi({ text }: { text: string }) {
  if (!hasAnsi(text)) return <>{text}</>
  const parts = []
  let style: Style = { color: null, bold: false, dim: false }
  let last = 0
  SGR.lastIndex = 0
  for (let m; (m = SGR.exec(text));) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), style })
    style = apply(style, m[1] ?? m[2])
    last = SGR.lastIndex
  }
  if (last < text.length) parts.push({ text: text.slice(last), style })
  return (
    <>
      {parts.map((p, i) => {
        const cls = [
          p.style.color && `ansi-${p.style.color}`,
          p.style.bold && 'ansi-bold',
          p.style.dim && 'ansi-dim',
        ]
          .filter(Boolean)
          .join(' ')
        return cls ? (
          <span key={i} class={cls}>
            {p.text}
          </span>
        ) : (
          p.text
        )
      })}
    </>
  )
}

/** Plain text with color codes removed, for titles and truncated labels. */
export function stripAnsi(text: string) {
  return text.replace(SGR, '')
}
