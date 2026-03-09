// packages/shared/src/utils.ts
// Core utilities: IDs, timestamps, hashing, idempotency keys.

// ============================================================
// ID GENERATION
// ============================================================

/** Generate a random UUID v4 */
export function newId(): string {
  // Works in both Node and CF Workers
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node
  const { randomUUID } = require("crypto") as typeof import("crypto");
  return randomUUID();
}

// ============================================================
// TIMESTAMPS
// ============================================================

/** Current time as ISO8601 UTC string */
export function now(): string {
  return new Date().toISOString();
}

/** Parse an ISO8601 string to a Date */
export function parseDate(s: string): Date {
  return new Date(s);
}

// ============================================================
// HASHING
// ============================================================

/** SHA-256 hex digest of a UTF-8 string */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(hashBuf);
}

/** SHA-256 hex digest of arbitrary bytes */
export async function sha256HexBytes(input: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", input);
  return bufToHex(hashBuf);
}

function bufToHex(buf: ArrayBuffer): string {
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// IDEMPOTENCY KEY
// ============================================================

/**
 * Canonical idempotency key for a stage attempt.
 * sha256(report_version_id + "|" + stage_name + "|" + input_hash + "|" + prompt_version)
 */
export async function stageIdempotencyKey(
  reportVersionId: string,
  stageName: string,
  inputHash: string,
  promptVersion: string,
): Promise<string> {
  const raw = `${reportVersionId}|${stageName}|${inputHash}|${promptVersion}`;
  return sha256Hex(raw);
}

// ============================================================
// INPUT HASHING
// ============================================================

/** Stable JSON hash (sorted keys) */
export async function hashObject(obj: unknown): Promise<string> {
  const stable = stableStringify(obj);
  return sha256Hex(stable);
}

/** Recursively stringify object with sorted keys */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
  );
  return "{" + pairs.join(",") + "}";
}

// ============================================================
// NORMALIZATION HELPERS
// ============================================================

/** Normalize a name string for entity matching */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize an address for deduplication */
export function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\broad\b/g, "rd")
    .replace(/\bsuite\b/g, "ste")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// SAFE HTML ESCAPING
// ============================================================

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
