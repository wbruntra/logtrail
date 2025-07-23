const request = require('supertest')
const app = require('../app')

describe('API Health Check', () => {
  it('should return status OK for /api/health', async () => {
    const res = await request(app).get('/api/health')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'OK' })
  })
})
