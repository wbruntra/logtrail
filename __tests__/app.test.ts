import app from '@/hono-app/app'
import { describe, expect, it } from 'bun:test'

describe('API Health Check', () => {
  it('should return status OK for /api/health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'OK' })
  })
})
