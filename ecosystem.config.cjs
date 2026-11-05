module.exports = {
  apps: [
    {
      name: 'logtrail-central',
      script: 'hono-app/bin/www.ts',
      interpreter: 'bun',
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 11411,
      },
    },
  ],
}
