import { createHash, randomUUID } from 'crypto';

/** Generate a UUID v4 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as { randomUUID?: () => string }).randomUUID === 'function') {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return randomUUID();
}

/** ISO 8601 UTC timestamp */
export function nowIso(): string {
  return new Date().toISOString();
}

/** SHA-256 hex of a string */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** SHA-256 hex of an object (deterministic JSON) */
export function hashObject(obj: unknown): string {
  return sha256(JSON.stringify(obj));
}

/** Normalize a name for comparison: lowercase, trim, collapse whitespace, remove punctuation */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize an address */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s,#.-]/g, '')
    .trim();
}

/** Levenshtein distance */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }
  return dp[m]![n]!;
}

/** Normalized string similarity 0–1 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Structured logger with correlation IDs */
export interface LogContext {
  permit_id?: string;
  report_id?: string;
  report_version_id?: string;
  attempt_id?: string;
  idempotency_key?: string;
  stage_name?: string;
  [key: string]: unknown;
}

export const logger = {
  info(message: string, ctx: LogContext = {}) {
    console.log(JSON.stringify({ level: 'info', message, ...ctx, ts: nowIso() }));
  },
  warn(message: string, ctx: LogContext = {}) {
    console.warn(JSON.stringify({ level: 'warn', message, ...ctx, ts: nowIso() }));
  },
  error(message: string, ctx: LogContext = {}) {
    console.error(JSON.stringify({ level: 'error', message, ...ctx, ts: nowIso() }));
  },
};
