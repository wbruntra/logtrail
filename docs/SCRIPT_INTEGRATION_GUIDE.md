# Logtrail — Script Integration Guide

This guide explains how to send error reports and run summaries from a server-side script to Logtrail, a centralised log monitoring app. It covers the ingest API, the structured event format, and practical patterns for scripts that run on a schedule.

---

## Overview

Logtrail receives log events via a simple HTTP endpoint. Events are stored for 3 days and displayed in a live log viewer with filtering, search, and colour-coded log levels.

Scripts integrate by sending JSON events to the ingest endpoint — typically at the start of a run, after each significant action, and on completion or failure. No SDK or library is required; a plain `fetch` call is sufficient.

---

## The Ingest Endpoint

```
POST https://<logtrail-host>/api/ingest
Authorization: Bearer <agent-secret>
Content-Type: application/json
```

The `agent-secret` is a shared secret configured in Logtrail. Ask the system administrator for the value and the host URL.

---

## Event Format

Every event is a JSON object. Two fields are required; everything else is optional but recommended.

```json
{
  "app":      "oauth-task-worker",
  "level":    "error",
  "msg":      "Human-readable description of what happened",

  "code":     "AUTH_ERROR",
  "duration": 47341,
  "stack":    "Error: ...\n  at ...",

  "tokenId":  12345,
  "platform": "instagram"
}
```

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `app` | string | Identifier for the script or service. Use a stable name like `oauth-task-worker`. All events from the same script should use the same value. |
| `level` | string | Severity. One of: `error`, `warn`, `info`, `debug`, `success`. |
| `msg` | string | A short human-readable description. This is the primary text shown in the log viewer. |

### Standard optional fields

These are recognised by Logtrail and displayed distinctly in the UI:

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | A stable short code identifying the error type. Examples: `AUTH_ERROR`, `RATE_LIMIT`, `DB_TIMEOUT`. Use the same code consistently across runs so errors can be grouped and counted. |
| `duration` | number | How long the operation took, in milliseconds. |
| `stack` | string | Full stack trace. Include for `error` level events; omit for everything else. |
| `userId` | string/number | If the operation relates to a user or account, include their ID. |

### Custom fields

Any additional fields are stored alongside the event and searchable in Logtrail. Add whatever context makes the event useful to debug:

```json
{
  "app":         "oauth-task-worker",
  "level":       "error",
  "msg":         "Token refresh failed — non-recoverable",
  "code":        "AUTH_ERROR",
  "tokenId":     12345,
  "platform":    "instagram",
  "recoverable": false,
  "userAction":  "REAUTH_REQUIRED",
  "step":        "token_exchange"
}
```

All fields are stored as-is. Avoid including secrets, tokens, or passwords in any field.

---

## Log Levels

Choose the level based on what the event means operationally:

| Level | When to use |
|-------|-------------|
| `error` | Something failed that shouldn't have: a task error, a timeout, an unexpected exception. |
| `warn` | Something unusual happened but execution continued: a fallback was used, a retry is scheduled, input was unexpected. |
| `info` | Normal milestones: run started, run completed, batch summary. |
| `success` | A task or run completed successfully (optional — `info` is fine too). |
| `debug` | Verbose detail useful during development. Can be left in code but filtered out of normal monitoring. |

---

## Sending an Event

A minimal helper — copy this into the script or a shared utility:

```js
async function sendLog(event) {
  try {
    await fetch('https://<logtrail-host>/api/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <agent-secret>',
      },
      body: JSON.stringify(event),
    })
  } catch {
    // Logtrail is best-effort — never let a logging failure affect the script
  }
}
```

Always fire-and-forget or use a short timeout. Logtrail should never be in the critical path of a script.

---

## Patterns for Scheduled Scripts

### 1. Run summary (most important)

Send one event when the run completes, whether it succeeded or not. This acts as a heartbeat — if Logtrail stops receiving run summaries, the cron itself has likely broken.

```js
// At the end of main(), regardless of success or failure
await sendLog({
  app: 'oauth-task-worker',
  level: 'info',
  msg: `Run complete: processed ${processed}, failed ${failed}, ${remaining} remaining`,
  code: 'RUN_COMPLETE',
  processed,
  failed,
  remaining,
  duration: Date.now() - runStartTime,
})
```

### 2. Task-level errors

Send one event per failed task. Include as much structured context as is already available — error category, whether it is recoverable, what action is required. Do not include the full database row or any credentials.

```js
await sendLog({
  app: 'oauth-task-worker',
  level: 'error',
  msg: `Task failed: ${error.category} — ${error.message}`,
  code: error.category,
  subCode: error.subCategory,
  step: error.step,
  recoverable: error.recoverable,
  userAction: error.userAction,
  tokenId: token_id,
  platform: oauth_task.platform,
})
```

### 3. Timeouts

If a timeout wrapper rejects, log it before rethrowing or continuing. Timeouts are a distinct failure mode worth tracking separately — they often indicate degraded external services rather than application bugs.

```js
if (error.message?.includes('timed out')) {
  await sendLog({
    app: 'oauth-task-worker',
    level: 'warn',
    msg: error.message,
    code: 'TIMEOUT',
    tokenId: token_id,
  })
}
```

### 4. Fatal crash

The outermost catch should always report to Logtrail before exiting. This is the signal that something went wrong that wasn't caught by task-level error handling.

```js
main().catch(async (error) => {
  await sendLog({
    app: 'oauth-task-worker',
    level: 'error',
    msg: `Fatal error: ${error.message}`,
    code: 'FATAL',
    stack: error.stack,
  })
  process.exit(1)
})
```

---

## What Not to Log

- **Every successful task individually.** For high-volume scripts, individual success events create noise. Log a batch summary instead.
- **Sensitive data.** OAuth tokens, passwords, API keys, or full request/response bodies should never appear in log events.
- **Redundant context.** If the error message already says "token 12345 failed", do not also put `tokenId: 12345` in the message text — put it in the field so it is searchable separately.
- **Non-actionable events.** If there is nothing a person could do with the information, it probably does not need to be a log event.

---

## Suggested Events for This Script

Based on the script structure, the following events cover the most useful monitoring surface area:

| Event | Level | When | Key fields |
|-------|-------|------|------------|
| Run complete | `info` | End of `runBatch()`, always | `processed`, `failed`, `remaining`, `duration` |
| No tasks found | `info` | When `runUpdateAccount` returns `no_tasks` | — |
| Task failed (standardised) | `error` | After `processStandardizedError` | `code`, `subCode`, `step`, `recoverable`, `userAction`, `tokenId`, `platform` |
| Task failed (legacy) | `warn` | After `processLegacyError` | `error`, `tokenId` |
| Timeout | `warn` | When `withTimeout` rejects | `code: 'TIMEOUT'`, `tokenId`, which operation timed out |
| Fatal crash | `error` | `main().catch(...)` | `stack` |

The run summary is the single most valuable event — it provides a heartbeat and a quick count of outcomes without requiring detailed analysis of per-task events.
