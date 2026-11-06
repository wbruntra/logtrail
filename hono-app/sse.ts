import type { SSEStreamingApi } from 'hono/streaming'

/**
 * Holds an SSE stream open, sending a heartbeat every 15 seconds to keep
 * intermediate proxies/load balancers alive, until the client goes away.
 */
export async function holdOpen(stream: SSEStreamingApi, cleanup: () => void): Promise<void> {
  const heartbeatInterval = setInterval(() => {
    stream.writeSSE({ event: 'ping', data: 'heartbeat' })
  }, 15000)

  await new Promise<void>((resolve) => {
    stream.onAbort(() => {
      clearInterval(heartbeatInterval)
      cleanup()
      resolve()
    })
  })
}
