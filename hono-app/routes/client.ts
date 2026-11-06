import path from 'node:path'
import { setupInstructions } from '@/services/setup-instructions'
import { Hono } from 'hono'

// Serves the drop-in SDK, so projects can fetch the current version:
//   curl -O https://<logtrail-host>/api/client/logtrail.ts
// .ts is the source (Bun, Node 22.18+, TS projects); .js (ESM) and .cjs (CommonJS)
// are built from it on first request. No auth: the file holds no secrets.

const SOURCE = path.join(import.meta.dir, '../../sdk/logtrail.ts')

const builds = new Map<string, Promise<string>>()

async function build(format: 'esm' | 'cjs'): Promise<string> {
  const source = await Bun.file(SOURCE).text()
  // Bundling drops comments; keep the usage docs at the top of the built file.
  const header = source.match(/^\/\*\*[\s\S]*?\*\//)?.[0] ?? ''
  const result = await Bun.build({ entrypoints: [SOURCE], format, target: 'node' })
  if (!result.success) throw new AggregateError(result.logs, 'Building the SDK failed')
  const code = await result.outputs[0].text()
  return `${header}\n// Built from logtrail.ts. Edit that file, not this one.\n\n${code}`
}

function cached(format: 'esm' | 'cjs'): Promise<string> {
  if (!builds.has(format)) {
    const pending = build(format)
    pending.catch(() => builds.delete(format)) // retry on the next request
    builds.set(format, pending)
  }
  return builds.get(format)!
}

const router = new Hono()

// Instructions for an LLM agent to wire a project to logtrail. Served as text/plain so a
// browser or fetch tool shows it as is. Holds no secrets, so it needs no auth.
router.get('/setup.md', async (c) => {
  const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.slice(0, -1)
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host
  c.header('Content-Type', 'text/plain; charset=utf-8')
  return c.body(await setupInstructions(`${proto}://${host}`))
})

router.get('/logtrail.ts', async (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8')
  return c.body(await Bun.file(SOURCE).text())
})

router.get('/agent.ts', async (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8')
  return c.body(await Bun.file(path.join(import.meta.dir, '../../agent/logtrail-agent.ts')).text())
})

router.get('/logtrail.js', async (c) => {
  c.header('Content-Type', 'text/javascript; charset=utf-8')
  return c.body(await cached('esm'))
})

router.get('/logtrail.cjs', async (c) => {
  c.header('Content-Type', 'text/javascript; charset=utf-8')
  return c.body(await cached('cjs'))
})

export default router
