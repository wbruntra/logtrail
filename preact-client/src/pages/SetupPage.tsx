import { useState } from 'preact/hooks'
import { Card, Loaded } from '../components/ui'
import { useApi } from '../lib/api'

const PATH = '/api/client/setup.md'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const onClick = async () => {
    setState((await copy(text)) ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <button type="button" class="btn primary" onClick={onClick}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

/** Instructions for an LLM agent to connect a project, as a link to hand over or markdown to paste. */
export function SetupPage() {
  const instructions = useApi<string>(PATH)
  const link = `${location.origin}${PATH}`
  return (
    <div class="page">
      <div class="page-head">
        <h1>Connect an app</h1>
        <p class="muted">Give these instructions to the coding agent working on the app.</p>
      </div>
      <Card title="Link" actions={<CopyButton text={link} label="Copy link" />}>
        <a href={PATH}>
          <code>{link}</code>
        </a>
      </Card>
      <Loaded resource={instructions}>
        {(text) => (
          <Card
            title="Instructions (markdown)"
            actions={<CopyButton text={text} label="Copy instructions" />}
          >
            <pre class="setup-text">{text}</pre>
          </Card>
        )}
      </Loaded>
    </div>
  )
}
