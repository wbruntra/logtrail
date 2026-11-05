import fs from 'node:fs'
import path from 'node:path'

// logtrail.config.yaml (gitignored; see example.logtrail.config.yaml). Read on
// every call so edits apply without a restart.

const configPath = path.join(import.meta.dir, '../logtrail.config.yaml')

const DEFAULT_RETENTION_DAYS = 3

export interface LogSource {
  name: string
  path: string
  description?: string
}

interface LogtrailConfig {
  logs?: LogSource[]
  /** Days to keep ingested events */
  retention_days?: number
}

function readConfig(): LogtrailConfig {
  try {
    return (Bun.YAML.parse(fs.readFileSync(configPath, 'utf8')) as LogtrailConfig) ?? {}
  } catch (err) {
    console.error('Error reading config:', err)
    return {}
  }
}

export function getLogConfig(): LogSource[] {
  return readConfig().logs || []
}

/** LOGTRAIL_RETENTION_DAYS, else retention_days from the config file, else 3. */
export function getRetentionDays(): number {
  const days = Number(process.env.LOGTRAIL_RETENTION_DAYS) || readConfig().retention_days
  return typeof days === 'number' && days > 0 ? days : DEFAULT_RETENTION_DAYS
}
