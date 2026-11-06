import { spawnSync } from 'node:child_process'
import { createLogtrail } from '@/sdk/logtrail'
import secrets from '@/secrets'
import ingestRouter from './routes/ingest'

// Logtrail reports its own errors under the app name "logtrail", using the same SDK
// it serves. Events go straight to the ingest route in-process rather than out
// through the network and back. Off under `bun test` and with LOGTRAIL_SELF_LOG=false.

function gitRelease(): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}

const inProcessFetch = ((_url: string, init?: RequestInit) =>
  ingestRouter.request('/', init)) as typeof fetch

export const logtrail = createLogtrail({
  url: 'http://logtrail.local',
  secret: secrets.agentSecret,
  app: 'logtrail',
  release: gitRelease(),
  enabled: process.env.NODE_ENV !== 'test' && process.env.LOGTRAIL_SELF_LOG !== 'false',
  // Ingest failures would feed back into ingest
  skip: ({ path }) => path.startsWith('/api/ingest'),
  fetch: inProcessFetch,
})
