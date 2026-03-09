/**
 * D1 database client abstraction.
 * In Cloudflare Workers: use D1Database binding.
 * In local dev/tests: use better-sqlite3 with the same interface.
 */

export interface DbRow {
  [key: string]: unknown;
}

export interface DbResult {
  results: DbRow[];
  meta?: { changes: number; last_row_id: number };
}

export interface Db {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  batch(statements: DbStatement[]): Promise<DbResult[]>;
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  run(): Promise<DbResult>;
  first<T = DbRow>(): Promise<T | null>;
  all<T = DbRow>(): Promise<{ results: T[] }>;
}

/**
 * Type-safe wrapper around a D1Database that implements Db.
 * Pass `env.DB` (your D1 binding) in Workers, or the local adapter in tests.
 */
export function createDb(d1: D1Database): Db {
  return {
    prepare(sql: string) {
      const stmt = d1.prepare(sql);
      return {
        bind(...values: unknown[]) {
          return stmt.bind(...values) as unknown as DbStatement;
        },
        async run() {
          const r = await stmt.run();
          return { results: [], meta: { changes: r.meta.changes, last_row_id: r.meta.last_row_id } };
        },
        async first<T = DbRow>() {
          return stmt.first<T>();
        },
        async all<T = DbRow>() {
          return stmt.all<T>();
        },
      } as DbStatement;
    },
    async exec(sql: string) {
      await d1.exec(sql);
    },
    async batch(statements: DbStatement[]) {
      // D1 batch API
      return d1.batch(statements as unknown as D1PreparedStatement[]) as unknown as DbResult[];
    },
  };
}

// D1Database type stub (provided by Cloudflare Workers runtime)
declare global {
  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    exec(sql: string): Promise<D1ExecResult>;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  }
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run<T = unknown>(): Promise<D1Result<T>>;
    first<T = unknown>(colName?: string): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
  }
  interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: { changes: number; last_row_id: number; duration: number };
  }
  interface D1ExecResult {
    count: number;
    duration: number;
  }
}
