# Logtrail Deployment Guide

## Quick Start

### 1. Local Development

For local development with central server mode:

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your settings
# Make sure LOGTRAIL_MODE=central

# Install dependencies
bun install

# Start development server
bun run dev:central
```

### 2. Production Deployment with PM2

#### Central Server Deployment

```bash
# Install PM2 globally
bun install -g pm2

# Deploy central server
bun run deploy:central

# Or manually:
./scripts/deploy.sh central production
```

#### Agent Deployment

```bash
# Copy agent environment template
cp .env.agent.template .env

# Edit .env with your agent configuration:
# - Set unique AGENT_ID
# - Set CENTRAL_SERVER_URL to your central server
# - Set unique AGENT_API_KEY

# Deploy agent
bun run deploy:agent

# Or manually:
./scripts/deploy.sh agent production
```

## Configuration Files

### Environment Variables (.env)

**Central Server:**

- `LOGTRAIL_MODE=central`
- `COOKIE_SECRET` - Secure session secret
- `PORT` - Server port (default: 3000)

**Agent:**

- `LOGTRAIL_MODE=agent`
- `AGENT_ID` - Unique agent identifier
- `AGENT_NAME` - Human-readable agent name
- `CENTRAL_SERVER_URL` - WebSocket URL of central server
- `AGENT_API_KEY` - Secure API key for authentication

### YAML Configuration

**Central Server:** `config/central.config.yaml`

- Server settings
- Local log configuration
- WebSocket settings
- Authentication settings

**Agent:** `config/agent.config.yaml`

- Agent identity
- Central server connection
- Local log files to monitor
- Security settings

## PM2 Commands

```bash
# Start services
bun run pm2:central     # Start central server
bun run pm2:agent       # Start agent

# Monitor
bun run pm2:logs        # View all logs
pm2 monit               # Interactive monitoring

# Control
bun run pm2:restart     # Restart all services
bun run pm2:stop        # Stop all services
pm2 restart logtrail-central  # Restart specific service

# View logs
pm2 logs logtrail-central
pm2 logs logtrail-agent
```

## Security

### Central Server

- Uses session cookies for user authentication
- Requires login via `/api/login` endpoint
- Protected routes require valid session

### Agent

- Uses API key authentication
- Connects outbound to central server (firewall-friendly)
- No user interface (API only)

## File Structure

```
├── config/
│   ├── index.js              # Configuration manager
│   ├── central.config.yaml   # Central server config
│   └── agent.config.yaml     # Agent config template
├── middleware/
│   └── auth.js               # Authentication middleware
├── scripts/
│   └── deploy.sh             # Deployment script
├── .env.example              # Development environment
├── .env.central.template     # Central server template
├── .env.agent.template       # Agent environment template
└── ecosystem.config.js       # PM2 configuration
```

## Troubleshooting

### Common Issues

1. **Authentication errors**: Check .env file has correct secrets
2. **Config validation fails**: Ensure all required environment variables are set
3. **PM2 won't start**: Check file permissions and paths
4. **Agent can't connect**: Verify CENTRAL_SERVER_URL and firewall settings

### Logs Location

- PM2 logs: `logs/central-*.log` or `logs/agent-*.log`
- Application logs: Check PM2 logs with `pm2 logs`

### Health Checks

- Central server: `GET /api/health`
- Agent: `GET /` (shows agent status)
- Authentication status: `GET /api/status`
