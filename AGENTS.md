# AGENTS.md - Coding Agent Guidelines for Logtrail

## Project Overview

Logtrail is a log viewing/streaming application with:
- **Backend**: Express.js server (CommonJS, runs on Bun)
- **Frontend**: React 19 + TypeScript + Vite client

---

## Build/Lint/Test Commands

### Backend (root directory)

```bash
bun install              # Install dependencies
bun run dev              # Development server (with watch)
bun run start            # Production server
bun test                 # Run all tests
bun test __tests__/app.test.js    # Run a single test file
bun test -t "should return status OK"  # Run tests by name pattern
```

### Frontend (client directory)

```bash
cd client
bun install              # Install dependencies
bun run dev              # Development server
bun run build            # Build for production (also type checks)
bun run lint             # Lint check
```

---

## Project Structure

```
logtrail/
├── app.js                 # Express app setup
├── bin/www                # Server entry point
├── routes/                # API routes (index.js, logs.js)
├── services/              # Business logic (config, file-watcher, tail-file)
├── middleware/            # Auth middleware
├── __tests__/             # Backend tests
└── client/src/            # React frontend (components, hooks, types, utils)
```

---

## Code Style Guidelines

### Backend (JavaScript/CommonJS)

**Imports**: Group logically - built-in first, then external, then local.
```javascript
const fs = require('fs')
const express = require('express')
const { getLogConfig } = require('../services/config')
```

**No semicolons**: Codebase does not use semicolons.

**Exports**: Use `module.exports` for CommonJS.
```javascript
module.exports = router
module.exports = { getLogConfig }
```

**Error handling**: Use try/catch in async functions.
```javascript
try {
  const result = await someAsyncOperation()
  res.json(result)
} catch (err) {
  res.status(500).json({ error: 'Failed...', details: err.message })
}
```

**Route validation**: Validate early and return:
```javascript
if (!logEntry) {
  res.status(400).json({ error: 'Invalid log file' })
  return
}
```

### Frontend (TypeScript/React)

**Imports**: Named imports, grouped by source.
```typescript
import { useEffect, useCallback, useState } from 'react'
import { Modal } from 'react-bootstrap'
import type { LogFile } from '../types/logTypes'
```

**Components**: Functional components with explicit prop types.
```typescript
interface HeaderProps {
  logFiles: LogFile[]
  selectedLog: string
  onLogChange: (logPath: string) => void
}

const Header: React.FC<HeaderProps> = ({ logFiles, selectedLog, onLogChange }) => {
  // ...
}

export default Header
```

**Hooks**: Custom hooks in `hooks/`, prefixed with `use`, return typed objects.

**Types**: Define in `types/` directory, use `interface` for object shapes.

**Event handlers**: Use `useCallback` for handlers passed as props.

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files (JS) | kebab-case | `file-watcher.js` |
| Files (TSX) | PascalCase | `Header.tsx` |
| Files (hooks) | camelCase with `use` prefix | `useLogStream.ts` |
| Variables | camelCase | `logFiles` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RESULTS` |
| Functions | camelCase | `getLogConfig` |
| Classes | PascalCase | `FileWatcher` |
| React components | PascalCase | `LogViewer` |
| Interfaces | PascalCase | `HeaderProps` |

---

## Testing

**Framework**: Jest-compatible (runs via Bun test)

**Location**: `__tests__/` directory

**Session testing**: Use `request.agent(app)` for cookie persistence.

```javascript
const request = require('supertest')
const app = require('../app')

describe('API Health Check', () => {
  it('should return status OK', async () => {
    const res = await request(app).get('/api/health')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'OK' })
  })
})
```

---

## Configuration

**Log files**: Configured in `logtrail.config.yaml`
**Environment**: `.env` file with secrets (COOKIE_SECRET, password)

---

## Important Notes

- Runtime is **Bun**, not Node.js - use Bun-specific APIs (`Bun.YAML.parse`)
- Frontend proxies `/api` requests to `http://localhost:12070` in development
- Session auth uses `cookie-session` middleware
- Server-Sent Events (SSE) for real-time log streaming
- Express 5 supports async handlers natively - no wrapper needed
- No code comments unless explicitly requested
