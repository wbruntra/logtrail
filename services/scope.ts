import type { SelectQueryBuilder } from 'kysely'

/** Narrows queries over events to one environment and/or one service of an app. */
export interface Scope {
  env?: string
  service?: string
}

export function inScope<Q extends SelectQueryBuilder<any, any, any>>(
  query: Q,
  { env, service }: Scope,
): Q {
  let scoped: SelectQueryBuilder<any, any, any> = query
  if (env) scoped = scoped.where('env', '=', env)
  if (service) scoped = scoped.where('service', '=', service)
  return scoped as Q
}
