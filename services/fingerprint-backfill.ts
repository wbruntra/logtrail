import type { Database } from '@database/schema'
import type { Kysely } from 'kysely'
import { fingerprint } from './fingerprint'

const BATCH = 5000

/**
 * Recomputes every stored fingerprint with the current fingerprint() and
 * carries issue states over to the new fingerprints, so a resolved or muted
 * issue stays that way after a rule change merges or renames it. Run from a
 * migration whenever fingerprint() changes. Returns the number of rows changed.
 */
export async function refingerprint(db: Kysely<Database>): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const moved = new Map<string, Set<string>>() // old -> new fingerprints
    const updates = new Map<string, number[]>() // new fingerprint -> ids
    let cursor = 0
    for (;;) {
      const rows = await trx
        .selectFrom('events')
        .select(['id', 'app', 'level', 'code', 'msg', 'method', 'route', 'path', 'status', 'stack'])
        .select('fingerprint')
        .where('level', 'in', ['error', 'warn'])
        .where('id', '>', cursor)
        .orderBy('id')
        .limit(BATCH)
        .execute()
      for (const row of rows) {
        const next = fingerprint(row)
        if (next === row.fingerprint || next === null) continue
        if (!updates.has(next)) updates.set(next, [])
        updates.get(next)!.push(row.id)
        if (row.fingerprint) {
          if (!moved.has(row.fingerprint)) moved.set(row.fingerprint, new Set())
          moved.get(row.fingerprint)!.add(next)
        }
      }
      if (rows.length < BATCH) break
      cursor = rows[rows.length - 1].id
    }

    let changed = 0
    for (const [next, ids] of updates) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        await trx
          .updateTable('events')
          .set({ fingerprint: next })
          .where('id', 'in', chunk)
          .execute()
        changed += chunk.length
      }
    }

    // A new fingerprint inherits the state of an old one that merged into it,
    // muted taking precedence, unless it already has a state of its own.
    const olds = [...moved.keys()]
    const states = olds.length
      ? await trx.selectFrom('issue_states').selectAll().where('fingerprint', 'in', olds).execute()
      : []
    const inherited = new Map<string, (typeof states)[number]>()
    const mutedLast = (s: (typeof states)[number]) => Number(s.status === 'muted')
    for (const state of states.sort((a, b) => mutedLast(a) - mutedLast(b))) {
      for (const next of moved.get(state.fingerprint)!) {
        inherited.set(next, { ...state, fingerprint: next })
      }
    }
    for (const state of inherited.values()) {
      await trx
        .insertInto('issue_states')
        .values(state)
        .onConflict((oc) => oc.column('fingerprint').doNothing())
        .execute()
    }
    return changed
  })
}
