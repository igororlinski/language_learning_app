/**
 * The part of Cloudflare's D1 API this Worker uses, typed by hand.
 *
 * `@cloudflare/workers-types` would bring the whole Workers runtime into the
 * type checker, where it fights `@types/node` over `Request` and `Response` —
 * and the tests run on Node. These few signatures match D1's own, and the
 * tests implement them on `node:sqlite` (`test/d1.ts`).
 */

export type D1Value = string | number | null;

export type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
};

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in one transaction: all of them or none. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export type Env = { DB: D1Database };
