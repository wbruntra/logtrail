import app from '@/hono-app/app'
import secrets from '@/secrets'
import { describe, expect, it } from 'bun:test'

function login(password: string) {
  return app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

describe('Authentication Flow', () => {
  it('should show unauthenticated status before login', async () => {
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'Unauthenticated', authenticated: false })
  })

  it('should login and set session cookie, then show authenticated status', async () => {
    const loginRes = await login(secrets.password)
    expect(loginRes.status).toBe(200)
    expect(await loginRes.json()).toMatchObject({
      message: 'Login successful',
      authenticated: true,
      token: expect.any(String),
    })

    // The browser sends the cookie back on later requests
    const cookie = loginRes.headers.get('Set-Cookie')!.split(';')[0]
    const statusRes = await app.request('/api/status', { headers: { Cookie: cookie } })
    expect(statusRes.status).toBe(200)
    expect(await statusRes.json()).toEqual({ status: 'Authenticated', authenticated: true })
  })

  it('should accept the login token as a bearer token', async () => {
    const { token } = (await (await login(secrets.password)).json()) as { token: string }
    const res = await app.request('/api/logs/list', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('should fail login with wrong password', async () => {
    const res = await login('wrongpassword')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid password', authenticated: false })
  })
})
