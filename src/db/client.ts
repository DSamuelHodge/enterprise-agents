/**
 * Thin D1 helpers. Replaces src/database/connection.py (SQLAlchemy async engine).
 *
 * Design note (migration doc §2): the old backend wrapped every DB call in a
 * dedicated Temporal workflow for retries/observability. On Cloudflare, D1
 * calls from Workers are ordinary awaited statements — no per-call workflow.
 * Flue Workflows are reserved for genuinely durable multi-step operations.
 */

export async function one<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...binds).first<T>();
  return row ?? null;
}

export async function many<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...binds).all<T>();
  return results;
}

export async function run(db: D1Database, sql: string, ...binds: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...binds).run();
}

/** Batch statements in one implicit transaction (D1 batches are atomic). */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return db.batch(statements);
}

export function json<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Build a partial UPDATE ... SET clause from a patch object, always bumping updated_at. */
export function buildUpdate(
  table: string,
  patch: Record<string, unknown>,
  idColumn = 'id',
): { sql: string; binds: unknown[] } | null {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return null;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  return {
    sql: `UPDATE ${table} SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${idColumn} = ?`,
    binds: keys.map((k) => patch[k]),
  };
}
