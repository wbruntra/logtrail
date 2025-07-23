const request = require('supertest')
const app = require('../app')
const secrets = require('../secrets')

describe('Authentication Flow', () => {
  it('should show unauthenticated status before login', async () => {
    const agent = request.agent(app)
    const res = await agent.get('/api/status')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'Unauthenticated', authenticated: false })
  })

  it('should login and set session cookie, then show authenticated status', async () => {
    const agent = request.agent(app)
    // Login with correct password
    const loginRes = await agent
      .post('/api/login')
      .send({ password: secrets.password })
    expect(loginRes.statusCode).toBe(200)
    expect(loginRes.body).toEqual({ message: 'Login successful', authenticated: true })

    // Use agent for subsequent request
    const statusRes = await agent.get('/api/status')
    expect(statusRes.statusCode).toBe(200)
    expect(statusRes.body).toEqual({ status: 'Authenticated', authenticated: true })
  })

  it('should fail login with wrong password', async () => {
    const agent = request.agent(app)
    const res = await agent
      .post('/api/login')
      .send({ password: 'wrongpassword' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'Invalid password', authenticated: false })
  })
})
