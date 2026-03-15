import type { Db, DbRow } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/src/utils/index';

export type PermitStatus = 'new' | 'normalized' | 'prequalified' | 'shortlisted' | 'rejected' | 'archived';

export interface PermitRow {
  id: string;
  city: string;
  source_permit_id: string;
  filed_date: string | null;
  issued_date: string | null;
  address_raw: string | null;
  address_norm: string | null;
  work_type: string | null;
  description_raw: string | null;
  valuation: number | null;
  applicant_raw: string | null;
  contractor_raw: string | null;
  owner_raw: string | null;
  status: PermitStatus;
  prequal_score: number;
  prequal_reasons_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertPermitInput {
  city: string;
  source_permit_id: string;
  filed_date?: string | null;
  issued_date?: string | null;
  address_raw?: string | null;
  address_norm?: string | null;
  work_type?: string | null;
  description_raw?: string | null;
  valuation?: number | null;
  applicant_raw?: string | null;
  contractor_raw?: string | null;
  owner_raw?: string | null;
}

export async function upsertPermit(db: Db, input: UpsertPermitInput): Promise<PermitRow> {
  const now = nowIso();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO permits (
        id, city, source_permit_id, filed_date, issued_date, address_raw, address_norm,
        work_type, description_raw, valuation, applicant_raw, contractor_raw, owner_raw,
        status, prequal_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)
      ON CONFLICT(city, source_permit_id) DO UPDATE SET
        filed_date = COALESCE(excluded.filed_date, permits.filed_date),
        issued_date = COALESCE(excluded.issued_date, permits.issued_date),
        address_raw = COALESCE(excluded.address_raw, permits.address_raw),
        address_norm = COALESCE(excluded.address_norm, permits.address_norm),
        work_type = COALESCE(excluded.work_type, permits.work_type),
        description_raw = COALESCE(excluded.description_raw, permits.description_raw),
        valuation = COALESCE(excluded.valuation, permits.valuation),
        applicant_raw = COALESCE(excluded.applicant_raw, permits.applicant_raw),
        contractor_raw = COALESCE(excluded.contractor_raw, permits.contractor_raw),
        owner_raw = COALESCE(excluded.owner_raw, permits.owner_raw),
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      input.city,
      input.source_permit_id,
      input.filed_date ?? null,
      input.issued_date ?? null,
      input.address_raw ?? null,
      input.address_norm ?? null,
      input.work_type ?? null,
      input.description_raw ?? null,
      input.valuation ?? null,
      input.applicant_raw ?? null,
      input.contractor_raw ?? null,
      input.owner_raw ?? null,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM permits WHERE city = ? AND source_permit_id = ?')
    .bind(input.city, input.source_permit_id)
    .first<PermitRow>();
  if (!row) throw new Error('upsertPermit: row not found after insert');
  return row;
}

export async function getPermitById(db: Db, id: string): Promise<PermitRow | null> {
  return db.prepare('SELECT * FROM permits WHERE id = ?').bind(id).first<PermitRow>();
}

export interface PermitListFilter {
  city?: string;
  status?: PermitStatus;
  minScore?: number;
  limit?: number;
  offset?: number;
}

export async function listPermits(db: Db, filter: PermitListFilter = {}): Promise<PermitRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.city) { conditions.push('city = ?'); values.push(filter.city); }
  if (filter.status) { conditions.push('status = ?'); values.push(filter.status); }
  if (filter.minScore !== undefined) { conditions.push('prequal_score >= ?'); values.push(filter.minScore); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  const sql = `SELECT * FROM permits ${where} ORDER BY prequal_score DESC, filed_date DESC LIMIT ? OFFSET ?`;
  values.push(limit, offset);

  const result = await db.prepare(sql).bind(...values).all<PermitRow>();
  return result.results;
}

export async function updatePermitStatus(
  db: Db,
  id: string,
  status: PermitStatus,
  prequalScore?: number,
  prequalReasons?: string[],
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE permits SET status = ?, prequal_score = COALESCE(?, prequal_score),
       prequal_reasons_json = COALESCE(?, prequal_reasons_json), updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      status,
      prequalScore ?? null,
      prequalReasons ? JSON.stringify(prequalReasons) : null,
      now,
      id,
    )
    .run();
}

export async function appendPermitEvent(
  db: Db,
  permitId: string,
  eventType: string,
  payload?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO permit_events (id, permit_id, event_type, event_payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), permitId, eventType, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

export async function insertPermitSource(
  db: Db,
  input: {
    permitId: string;
    sourceName: string;
    sourceUrl?: string;
    rawPayload: unknown;
    hash: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO permit_sources (id, permit_id, source_name, source_url, raw_payload_json, retrieved_at, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      input.permitId,
      input.sourceName,
      input.sourceUrl ?? null,
      JSON.stringify(input.rawPayload),
      nowIso(),
      input.hash,
    )
    .run();
}
