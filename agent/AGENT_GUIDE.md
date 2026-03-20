# Logtrail Agent Guide

## How It Works

The agent is a lightweight script that runs on each of your servers. It watches log files you specify and ships new lines to your central logtrail instance over HTTP. Logtrail stamps each line with an ingestion timestamp and stores it in a daily file. After 3 days, old files are deleted automatically.

```
Your server                       Central logtrail
──────────────────────────────    ──────────────────────────────
logtrail-agent                →   POST /api/ingest
  tails /var/log/nginx/*.log       adds timestamp
  tails /home/deploy/app.log       writes to ingested-logs/
  buffers + batches every 500ms    streams to browser UI
```

No changes are needed to your existing apps. The agent just watches whatever files are already on disk.

## Setup

### 1. Set a strong agent secret

On your central logtrail server, set the `AGENT_SECRET` environment variable (or edit `secrets.js`):

```bash
export AGENT_SECRET="some-long-random-string"
```

### 2. Configure the agent

Copy `agent.config.yaml` to each remote server and fill in the values:

```yaml
central_url: "http://your-logtrail-server:12070"
agent_secret: "some-long-random-string"   # must match AGENT_SECRET on central
app_name: "web-server-1"                  # label shown in the UI
files:
  - /var/log/nginx/access.log
  - /var/log/nginx/error.log
  - /home/deploy/myapp/logs/app.log
```

`app_name` is how the source appears in the logtrail UI. Use something that identifies the server or service (e.g. `api-server`, `db-server`, `nginx-prod`).

### 3. Copy the agent files

```bash
scp agent/logtrail-agent.js agent/agent.config.yaml user@remote-server:~/logtrail-agent/
```

The agent needs Bun and the `tail-stream` package. The easiest way is to also copy `node_modules/tail-stream`:

```bash
scp -r node_modules/tail-stream user@remote-server:~/logtrail-agent/node_modules/tail-stream
```

Or install it directly on the remote server:

```bash
bun add tail-stream
```

### 4. Run the agent

```bash
bun logtrail-agent.js
# or with a custom config path:
bun logtrail-agent.js --config /etc/logtrail/agent.config.yaml
```

#### Keep it running with pm2

```bash
pm2 start --interpreter bun logtrail-agent.js --name logtrail-agent
pm2 save
```

#### Or as a systemd service

```ini
[Unit]
Description=Logtrail Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/bun /home/deploy/logtrail-agent/logtrail-agent.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now logtrail-agent
```

---

## How logs appear in the UI

Each `app_name` becomes its own source in the log file selector. Ingested logs are shown alongside any locally-configured log files. Each line is prefixed with an ISO 8601 timestamp added by the central server at ingestion time:

```
2026-03-20T14:23:11.234Z original log line from your app
```

Since the timestamp is added on receipt, it's consistent regardless of what format (or no format) your apps use.

---

## Storage

Logs are stored on the central server at:

```
ingested-logs/
  web-server-1/
    2026-03-18.log
    2026-03-19.log
    2026-03-20.log   ← today, actively written
```

Files older than 3 days are deleted automatically when logtrail starts and once per day while it runs.

---

## Behaviour when central is unreachable

The agent buffers up to 1000 lines in memory and retries every 500ms. If the buffer fills (e.g. during a long outage), the oldest lines are dropped first. It logs a single error message when it loses connectivity and a single message when it reconnects — it won't spam your terminal.

---

## Security notes

- Keep `agent_secret` out of version control. Use the `AGENT_SECRET` environment variable on both the central server and (if possible) the agent host rather than hardcoding it in the YAML file.
- The ingest endpoint is separate from the browser UI and uses its own auth — agent tokens cannot be used to log in to the UI.
- If your logtrail instance is exposed to the internet, put it behind a reverse proxy with TLS so the agent secret isn't sent in cleartext.
