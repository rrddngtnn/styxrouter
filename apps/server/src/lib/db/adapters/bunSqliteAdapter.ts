import { requireSynchronous, requireSynchronousCallback } from "./synchronous";
import type { PreparedStatement, RunResult, SqliteAdapter } from "./types";

/**
 * The Bun runtime already ships a SQLite driver. Keep this adapter deliberately
 * small so the rest of the application can use the same driver contract as
 * better-sqlite3, node:sqlite, and sql.js.
 */
export interface BunSqliteDatabaseLike {
  readonly inTransaction: boolean;
  query(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  serialize?(): Uint8Array;
  transaction<T>(fn: (...args: unknown[]) => T): {
    (...args: unknown[]): T;
    immediate?: (...args: unknown[]) => T;
  };
  close(): void;
}

function normalizeRunResult(result: {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}): RunResult {
  return {
    changes: Number(result.changes ?? 0),
    lastInsertRowid: Number(result.lastInsertRowid ?? 0),
  };
}

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length !== 1) return params;
  const [first] = params;
  if (
    first === null ||
    typeof first !== "object" ||
    Array.isArray(first) ||
    first instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(first))
  ) {
    return params;
  }

  // better-sqlite3 callers use bare object keys for @name, :name, and $name.
  // Bun requires the sigil to match the SQL placeholder, so provide all three
  // aliases just as the sql.js adapter does.
  const expanded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
    if (/^[:@$]/.test(key)) {
      expanded[key] = value;
    } else {
      expanded[`@${key}`] = value;
      expanded[`:${key}`] = value;
      expanded[`$${key}`] = value;
    }
  }
  return [expanded];
}

export function createBunSqliteAdapter(db: BunSqliteDatabaseLike, filePath: string): SqliteAdapter {
  let isOpen = true;
  // Bun's run().changes includes trigger and foreign-key cascade writes. The
  // shared adapter contract counts only rows changed by the top-level statement,
  // matching SQLite changes() and the other drivers.
  const directChanges = db.query("SELECT changes() AS changes");

  return {
    driver: "bun:sqlite",

    get open() {
      return isOpen;
    },

    get inTransaction() {
      return db.inTransaction;
    },

    get name() {
      return filePath;
    },

    prepare(sql: string): PreparedStatement {
      const statement = db.query(sql);
      return {
        run(...params: unknown[]): RunResult {
          const result = statement.run(...normalizeParams(params));
          const row = directChanges.get() as { changes: number | bigint };
          return normalizeRunResult({ ...result, changes: row.changes });
        },
        get(...params: unknown[]): unknown {
          const row = statement.get(...normalizeParams(params));
          return row === null ? undefined : row;
        },
        all(...params: unknown[]): unknown[] {
          return statement.all(...normalizeParams(params));
        },
      };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    pragma(pragmaStr: string, options?: { simple?: boolean }): unknown {
      const statement = db.query(`PRAGMA ${pragmaStr}`);
      if (options?.simple) {
        const row = statement.get() as Record<string, unknown> | undefined;
        return row ? (Object.values(row)[0] ?? null) : null;
      }
      return statement.all();
    },

    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return db.transaction((...args) => { requireSynchronousCallback(fn); return requireSynchronous(fn(...args)); });
    },

    immediate<T>(fn: () => T): T {
      requireSynchronousCallback(fn);
      const transaction = db.transaction(() => requireSynchronous(fn()));
      if (typeof transaction.immediate === "function") {
        return transaction.immediate();
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = requireSynchronous(fn());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    },

    async backup(destination: string): Promise<void> {
      // VACUUM INTO creates a consistent SQLite snapshot, including committed WAL
      // frames even when another connection prevents checkpointing.
      db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    },

    checkpoint(mode = "TRUNCATE"): void {
      try {
        db.exec(`PRAGMA wal_checkpoint(${mode})`);
      } catch {}
    },

    close(): void {
      if (!isOpen) return;
      db.close();
      isOpen = false;
    },

    get raw() {
      return db;
    },
  };
}
