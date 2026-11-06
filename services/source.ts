// Where an event comes from: app (the product / codebase), service (a process within
// it: api, a worker) and env. Apps used to be one per process, named by whoever
// configured the sender, so the same product arrived under several spellings. Names are
// normalised and known old names are folded into their product here.

export interface Source {
  app: string
  service: string
  env: string
}

export const DEFAULT_ENV = 'production'

/** Old per-process names (normalised) and the app/service they belong to. Edit as products are added. */
export const SOURCE_ALIASES: Record<string, { app: string; service: string }> = {
  'talent-backend': { app: 'talent-sales', service: 'talent-backend' },
  'redesign-api': { app: 'talent-sales', service: 'talent-backend' },
  'redesign-api-error': { app: 'talent-sales', service: 'talent-backend' },
  'admin-api': { app: 'talent-sales', service: 'talent-backend' },
  'tpp-auth': { app: 'talent-sales', service: 'tpp-auth' },
  'oauth-task-worker': { app: 'talent-sales', service: 'oauth-task-worker' },
  'youtube-oauth-worker': { app: 'talent-sales', service: 'youtube-oauth-worker' },
  'story-refresh-worker': { app: 'talent-sales', service: 'story-refresh-worker' },
  'mini-refresh-worker': { app: 'talent-sales', service: 'mini-refresh-worker' },
  'oauth-enqueue': { app: 'talent-sales', service: 'oauth-enqueue' },
  'athios-api': { app: 'athios', service: 'athios-api' },
}

/** Lowercase, with runs of anything but letters and digits as a single hyphen: Oauth_Task_Worker -> oauth-task-worker. */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * An explicit service is trusted: the app is only normalised. Without one, the app name
 * is looked up as an old per-process name, else it is both app and service.
 */
export function resolveSource(app: string, service?: string | null, env?: string | null): Source {
  const name = normalizeName(app)
  const resolvedEnv = (env && normalizeName(env)) || DEFAULT_ENV
  const explicit = service ? normalizeName(service) : ''
  if (explicit)
    return { app: SOURCE_ALIASES[name]?.app ?? name, service: explicit, env: resolvedEnv }
  const alias = SOURCE_ALIASES[name]
  return { app: alias?.app ?? name, service: alias?.service ?? name, env: resolvedEnv }
}
