#!/usr/bin/env bun

import { db } from '@database/db'
import { migrateToLatest } from '@database/migrate'
import app from '@/hono-app/app'
import secrets from '@/secrets'

const decoder = new TextDecoder()

async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: secrets.password }),
  })

  if (!res.ok) {
    throw new Error(`Login failed with HTTP ${res.status}`)
  }

  const data = (await res.json()) as { token?: string }
  if (!data.token) {
    throw new Error('Login response did not include a token')
  }

  return data.token
}

async function ingest(baseUrl: string, appName: string, lines: string[]) {
  const res = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secrets.agentSecret}`,
    },
    body: JSON.stringify({ app: appName, events: lines.map((msg) => ({ level: 'info', msg })) }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ingest failed with HTTP ${res.status}: ${text}`)
  }

  return res.json()
}

async function waitForStreamedLine(
  baseUrl: string,
  token: string,
  appName: string,
  expectedSubstring: string,
  timeoutMs = 8000,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(
      `${baseUrl}/api/logs/stream?file=${encodeURIComponent(`ingested:${appName}`)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      },
    )

    if (!res.ok || !res.body) {
      throw new Error(`Stream request failed with HTTP ${res.status}`)
    }

    const reader = res.body.getReader()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        throw new Error('Stream ended before expected line arrived')
      }

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const rawEvent of events) {
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())

        if (!dataLines.length) continue

        const payload = dataLines.join('\n')
        let parsed
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }

        if (parsed?.content?.includes(expectedSubstring)) {
          return parsed
        }
      }
    }
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

async function main() {
  await migrateToLatest()

  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
    idleTimeout: 0,
  })

  const appName = `verify_stream_${Date.now()}`
  const liveLine = `live verification line ${Date.now()}`
  const baseUrl = `http://127.0.0.1:${server.port}`

  try {
    await ingest(baseUrl, appName, ['setup line'])
    const token = await login(baseUrl)

    const streamPromise = waitForStreamedLine(baseUrl, token, appName, liveLine)

    await new Promise((resolve) => setTimeout(resolve, 250))
    await ingest(baseUrl, appName, [liveLine])

    const streamed = await streamPromise

    console.log('✅ Ingested log streaming verified')
    console.log(JSON.stringify({ appName, streamed }, null, 2))
  } finally {
    server.stop(true)
    await db.deleteFrom('events').where('app', '=', appName).execute()
  }
}

// Exit explicitly: the app's daily cleanup interval would keep the process alive.
main()
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
