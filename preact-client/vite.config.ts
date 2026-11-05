import { fileURLToPath } from 'node:url'
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// The API server to proxy /api to in dev. Defaults to a dev backend
// (`PORT=12070 bun --watch hono-app/bin/www.ts`), not production on 11411.
const api = process.env.LOGTRAIL_API ?? 'http://localhost:12070'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    // Listen on every interface so the dev server is reachable over Tailscale
    // (ufw only admits tailscale0 traffic on this port), at the machine's
    // MagicDNS name or its short name.
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.ts.net', 'gaybor-new'],
    proxy: {
      '/api': { target: api, changeOrigin: true },
    },
  },
})
