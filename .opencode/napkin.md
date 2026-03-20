# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-03-20 | self | Tried to verify SSE behavior with long inline shell one-liners that were awkward to observe and easy to interrupt | Prefer checked-in verification scripts for multi-step streaming/debug tasks |
| 2026-03-20 | user | Used in-line scripts when a real file would be easier to inspect and rerun | Write actual repo files for verification when the workflow is more than a trivial command |

## User Preferences
- Prefer actual files/scripts over brittle in-line terminal one-liners for debugging and verification.

## Patterns That Work
- For ingested logs, verify live updates with a dedicated script that starts the app, opens the SSE endpoint, posts an ingest payload, and asserts the streamed line arrives.

## Patterns That Don't Work
- Assuming an in-memory event emitter is enough for live updates when refresh/history reads from shared files.

## Domain Notes
- Ingested logs are stored under `ingested-logs/<app>/<YYYY-MM-DD>.log` and can be streamed from the underlying file.
