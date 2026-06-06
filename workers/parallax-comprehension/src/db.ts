// Tiny helpers over the iii `database` worker (SQLite). Verified API
// (https://workers.iii.dev/workers/database, 2026-06-05):
//   database::query   { db, sql, params } -> { rows, row_count, columns }
//   database::execute { db, sql, params } -> { affected_rows, last_insert_id, returned_rows }
//   database::transaction { db, statements: [{ sql, params }] } -> atomic, all-or-nothing
export const DB = 'primary' // matches `databases.primary` in config.yaml

// Minimal structural type for the bits of the iii worker we use — avoids the fragile
// `ReturnType<typeof registerWorker>` (a value import used only in a type position).
interface Bus {
  trigger<I, O>(req: { function_id: string; payload: I }): Promise<O>
}

export type Stmt = { sql: string; params?: unknown[] }

export const makeDb = (iii: Bus) => ({
  exec: (sql: string, params: unknown[] = []) =>
    iii.trigger<{ db: string; sql: string; params: unknown[] }, unknown>({
      function_id: 'database::execute',
      payload: { db: DB, sql, params },
    }),
  query: <T>(sql: string, params: unknown[] = []) =>
    iii
      .trigger<{ db: string; sql: string; params: unknown[] }, { rows: T[] }>({
        function_id: 'database::query',
        payload: { db: DB, sql, params },
      })
      .then((r) => r.rows),
  // Atomic statement batch. [first-run check] confirm database::transaction's payload shape on the
  // installed worker — assumed { db, statements: [{ sql, params }] }, all-or-nothing. If the shape
  // differs, fall back to the beginTransaction -> transactionExecute(xN) -> commitTransaction family
  // (both are listed by the registry); wrap that in try/catch -> rollbackTransaction on error.
  tx: (statements: Stmt[]) =>
    iii.trigger<{ db: string; statements: Stmt[] }, unknown>({
      function_id: 'database::transaction',
      payload: { db: DB, statements },
    }),
})
