# Distributed Architecture Proposal: Multi-System Log Monitoring

This document outlines a comprehensive plan to extend the logtrail application to monitor log files across multiple systems using an agent-based architecture.

## Overview

Currently, logtrail monitors log files on a single system using local file operations. This proposal enables monitoring log files across multiple remote systems while maintaining the same user experience and minimal network complexity.

## Architecture Design

### Core Concept: Agent-Based System

The solution involves deploying lightweight "agent" instances of logtrail on remote systems that communicate with a central server through persistent WebSocket connections.

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Browser  │    │  Central Server  │    │  Remote Agent   │
│                 │    │                  │    │                 │
│ React Frontend  │◄──►│  Express + WS    │◄──►│ Express (Agent) │
│ (HTTP/SSE)      │    │  (HTTP/WS/SSE)   │    │ (WS Client)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                │                        │
                         Local Log Files          Remote Log Files
```

### Key Benefits

1. **Outbound-Only Connections**: Agents initiate connections to central server, eliminating firewall complexity
2. **Unified Interface**: Users interact with a single web interface regardless of log source
3. **Real-Time Streaming**: Maintains current SSE streaming capabilities for all log sources
4. **Same Codebase**: Central server and agents use the same application with different configurations

## Technical Implementation

### 1. Connection Model: WebSocket-Based Communication

**Traditional HTTP Model (Complex):**
```
Central Server → HTTP Request → Agent Server:3001
                ↑ Requires firewall rules, port forwarding
```

**Proposed WebSocket Model (Simple):**
```
Agent → WebSocket Connection → Central Server
       ↑ Standard outbound web traffic, no firewall changes needed
```

#### How WebSocket Communication Works

1. **Agent Startup**: Agent connects to central server via WebSocket
2. **Authentication**: Agent authenticates using API key
3. **Registration**: Agent registers its available log files
4. **Request Handling**: Central server sends requests through existing WebSocket
5. **Response**: Agent processes requests and responds through same connection

### 2. Dual-Mode Application Architecture

The same Express.js application runs in two modes:

#### Central Server Mode
- Full web application with React frontend
- Session-based user authentication
- Handles both local and remote log files
- WebSocket server for agent connections
- SSE streaming to user browsers

#### Agent Mode
- Lightweight API server
- API key authentication
- WebSocket client to central server
- No frontend serving
- Only provides log data to central server

### 3. Authentication Strategy

#### User Authentication (Central Server)
- **Method**: Session cookies (existing implementation)
- **Scope**: User browser ↔ Central server
- **Purpose**: Protect user access to web interface

#### Internal Authentication (Agent Communication)
- **Method**: API keys via WebSocket headers
- **Scope**: Agent ↔ Central server
- **Purpose**: Secure internal service communication

#### Authentication Flow
```
1. User authenticates with central server (session cookie)
2. User requests remote log → Central server validates session
3. Central server forwards request to agent (API key)
4. Agent validates API key and processes request
5. Agent responds to central server
6. Central server responds to user
```

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Mode Detection System
Create configuration system to determine application mode:

**File: `config/mode.js`**
```javascript
const getMode = () => process.env.LOGTRAIL_MODE || 'central'
const isCentralServer = () => getMode() === 'central'
const isAgent = () => getMode() === 'agent'
```

#### 1.2 Conditional Middleware Setup
Modify `app.js` to apply different middleware based on mode:

**Central Server Middleware:**
- Cookie session management
- Static file serving (React frontend)
- User authentication routes
- WebSocket server setup

**Agent Middleware:**
- API key authentication
- WebSocket client setup
- Agent-specific routes only

#### 1.3 Authentication Middleware
Create mode-appropriate authentication:

**File: `middleware/auth.js`**
- `requireLogin()` - Session-based auth for central server
- `requireAgentAuth()` - API key auth for agents
- `getAuthMiddleware()` - Returns appropriate middleware based on mode

### Phase 2: Communication Layer

#### 2.1 WebSocket Server (Central Server)
Implement WebSocket server to accept agent connections:

**Features:**
- Agent registration and discovery
- Request/response correlation
- Connection health monitoring
- Graceful reconnection handling

#### 2.2 WebSocket Client (Agent)
Implement WebSocket client for agents:

**Features:**
- Auto-connection to central server
- Heartbeat/keepalive mechanism
- Request processing and response routing
- Automatic reconnection on disconnect

#### 2.3 Request Forwarding System
Create abstraction layer in central server:

**Functionality:**
- Route requests to appropriate handler (local vs remote)
- Transform WebSocket communication into Promise-based API
- Handle timeouts and error cases
- Maintain connection pool management

### Phase 3: Configuration Management

#### 3.1 Enhanced Log Configuration
Extend `logtrail.config.yaml` to support remote logs:

```yaml
logs:
  # Local logs (existing)
  - name: "Local System Log"
    path: "/var/log/syslog"
    type: "local"
    description: "Local system logs"
    
  # Remote logs (new)
  - name: "Web Server Logs"
    path: "/var/log/nginx/access.log"
    type: "remote"
    agent: "web-server-01"
    description: "Production web server access logs"
    
  - name: "Database Logs"
    path: "/var/log/postgresql/postgresql.log"
    type: "remote"
    agent: "db-server-01"
    description: "Database server logs"

# Agent registry (central server only)
agents:
  - id: "web-server-01"
    name: "Production Web Server"
    description: "Main web application server"
    
  - id: "db-server-01"
    name: "Database Server"
    description: "PostgreSQL database server"
```

#### 3.2 Agent Configuration
Each agent has its own configuration file:

```yaml
# agent.config.yaml
agent:
  id: "web-server-01"
  name: "Production Web Server"
  central_server: "wss://logtrail-central.company.com"
  api_key: "${AGENT_API_KEY}"
  
logs:
  - name: "Nginx Access Log"
    path: "/var/log/nginx/access.log"
    description: "Web server access logs"
  - name: "Application Log"
    path: "/app/logs/application.log"
    description: "Main application logs"
```

### Phase 4: Route Implementation

#### 4.1 Enhanced Central Server Routes
Update existing `routes/logs.js` to handle both local and remote logs:

**Key Changes:**
- Detect log type from configuration
- Route local logs to existing handlers
- Route remote logs to agent communication layer
- Maintain identical API interface

#### 4.2 Agent Routes
Create `routes/agent.js` for agent-specific endpoints:

**Endpoints:**
- `GET /api/agent/tail` - Get last N lines of log file
- `GET /api/agent/history` - Get paginated log history
- `GET /api/agent/list` - List available log files
- `GET /api/agent/search` - Search log content
- `GET /api/agent/context/:lineNumber` - Get context around line

#### 4.3 WebSocket Route Handlers
Implement WebSocket message routing:

**Message Types:**
- `agent_hello` - Agent registration
- `get_tail` - Request log tail
- `get_history` - Request log history
- `start_stream` - Begin real-time streaming
- `stop_stream` - End real-time streaming
- `search` - Search log content

### Phase 5: Frontend Integration

#### 5.1 Transparent Remote Log Support
No frontend changes required - existing components work seamlessly:

- Log file selector shows both local and remote logs
- Real-time streaming works identically
- Search and history features function normally
- Agent connection status can be displayed optionally

#### 5.2 Enhanced UI Features (Optional)
Consider adding agent-specific features:

- Agent connection status indicators
- Agent health monitoring
- Remote log metadata display
- Multi-agent log correlation

## Deployment Guide

### Development Setup

#### 1. Central Server
```bash
# Set environment variables
export LOGTRAIL_MODE=central
export COOKIE_SECRET=your-cookie-secret

# Start development server
npm run dev:central
```

#### 2. Agent Setup
```bash
# Set environment variables
export LOGTRAIL_MODE=agent
export AGENT_API_KEY=your-secret-agent-key
export CENTRAL_SERVER_URL=ws://localhost:3000

# Start agent
npm run dev:agent
```

### Production Deployment

#### 1. Central Server Deployment
```bash
# Environment configuration
LOGTRAIL_MODE=central
COOKIE_SECRET=production-cookie-secret
NODE_ENV=production

# Start service
npm start
```

#### 2. Agent Deployment (per remote system)
```bash
# Environment configuration
LOGTRAIL_MODE=agent
AGENT_API_KEY=unique-agent-key
CENTRAL_SERVER_URL=wss://logtrail-central.company.com
NODE_ENV=production

# Start agent service
npm start
```

### Docker Deployment

#### Central Server Dockerfile
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV LOGTRAIL_MODE=central
EXPOSE 3000
CMD ["npm", "start"]
```

#### Agent Dockerfile
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV LOGTRAIL_MODE=agent
CMD ["npm", "start"]
```

## Security Considerations

### Network Security
- All WebSocket connections use WSS (WebSocket over TLS)
- Agents only make outbound connections (firewall-friendly)
- No inbound ports required on agent systems

### Authentication Security
- Central server uses existing session-based authentication
- Agent communication secured with API keys
- API keys stored in environment variables, not config files
- Separate API key per agent for granular access control

### Access Control
- Users authenticate only with central server
- Central server validates all user requests before forwarding
- Agents trust central server based on API key validation
- File access limited by agent configuration

## Monitoring and Operations

### Health Checks
- Central server monitors agent connection status
- Heartbeat mechanism detects connection issues
- Automatic reconnection for transient network issues
- Alert on prolonged agent disconnection

### Logging and Debugging
- WebSocket connection events logged
- Request/response correlation IDs for debugging
- Agent registration and deregistration events
- Performance metrics for remote vs local operations

### Troubleshooting
- Agent connection status visible in UI
- WebSocket connection diagnostics
- API key validation error messages
- Network connectivity testing tools

## Performance Considerations

### Latency
- WebSocket connections provide low-latency communication
- Persistent connections eliminate connection overhead
- Real-time streaming maintains current performance

### Scalability
- Central server can handle multiple concurrent agents
- Each agent operates independently
- Horizontal scaling through multiple central servers possible

### Resource Usage
- Agents have minimal resource requirements
- WebSocket connections use less memory than HTTP polling
- File watching operations remain local to each system

## Migration Strategy

### Incremental Adoption
1. **Phase 1**: Deploy enhanced central server (backward compatible)
2. **Phase 2**: Deploy first agent on one remote system
3. **Phase 3**: Gradually migrate additional systems to agents
4. **Phase 4**: Add advanced distributed features

### Rollback Plan
- Central server remains fully functional without agents
- Local log monitoring unaffected by agent deployment
- Agents can be stopped without affecting central server
- Configuration changes are non-breaking

## Future Enhancements

### Advanced Features
- Service discovery for automatic agent registration
- Load balancing across multiple central servers
- Cross-agent log correlation and analysis
- Distributed alerting and notification system

### Integration Opportunities
- Integration with existing monitoring systems
- Support for log forwarding protocols (syslog, fluentd)
- Container orchestration integration (Kubernetes)
- Cloud provider integration (AWS CloudWatch, etc.)

## Conclusion

This distributed architecture proposal provides a scalable, secure, and maintainable solution for multi-system log monitoring. The agent-based approach minimizes network complexity while maintaining the current user experience and extending capabilities to remote systems.

The implementation can be done incrementally, allowing for gradual adoption and minimal risk to existing functionality. The same codebase serves both central server and agent roles, reducing maintenance overhead and ensuring consistency across deployments.
