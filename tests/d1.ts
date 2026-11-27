import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Env } from "../worker";

export function testDatabase(database: DatabaseSync): Env["DB"] {
  // Use SQLite for SQL, constraints and rollback. The adapter mirrors the D1 methods used by the API.
  function prepare(sql: string, values: SQLInputValue[] = []) {
    return {
      bind: (...params: SQLInputValue[]) => prepare(sql, params),
      all: () => ({ results: database.prepare(sql).all(...values) }),
      first: () => database.prepare(sql).get(...values) ?? null,
      run: () => database.prepare(sql).run(...values),
      execute: () => {
        const statement = database.prepare(sql);
        if (statement.columns().length) return { results: statement.all(...values) };
        return { results: [], meta: statement.run(...values) };
      },
    };
  }
  return {
    prepare,
    withSession: () => ({ prepare }),
    batch(statements: ReturnType<typeof prepare>[]) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as Env["DB"];
}
