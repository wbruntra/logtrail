export default async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const urlObj = new URL(c.req.url)
  const url = urlObj.pathname + (urlObj.search || '')

  await next()

  const status = c.res.status || 0
  const time = Date.now() - start
  const user_id = c.get('user_id') as any

  // ANSI color helpers
  const RESET = '\u001b[0m'
  const colorStatus = (s: number) =>
    s >= 500 ? '\u001b[31m' : s >= 400 ? '\u001b[33m' : s >= 300 ? '\u001b[36m' : '\u001b[32m'
  const colorMethod = (m: string) =>
    m === 'GET'
      ? '\u001b[34m'
      : m === 'POST'
      ? '\u001b[35m'
      : m === 'PUT'
      ? '\u001b[33m'
      : '\u001b[36m'

  const methodStr = `${colorMethod(method)}${method}${RESET}`
  const statusStr = `${colorStatus(status)}${status}${RESET}`
  const userStr = user_id ? ` user=${user_id}` : ''

  console.log(`${methodStr} ${url} ${statusStr} ${time}ms${userStr}`)
}
