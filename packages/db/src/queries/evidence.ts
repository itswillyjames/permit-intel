import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/utils/index.js';

export type EvidenceType = 'web_page' | 'registry' | 'pdf' | 'image' | 'note' | 'model_response';
export type EvidenceLinkType = 'permit' | 'entity' | 'report_version' | 'export';
export type EvidenceStatus = 'active' | 'deprecated';

export interface EvidenceItemRow {
  id: string;
  type: EvidenceType;
  source: string;
  title: string | null;
  retrieved_at: string;
  hash: string;
  storage_ref: string | null;
  mime_type: string | null;
  bytes_len: number | null;
  status: EvidenceStatus;
  created_at: string;
}

export interface InsertEvidenceInput {
  type: EvidenceType;
  source: string;
  title?: string;
  hash: string;
  storageRef?: string;
  mimeType?: string;
  bytesLen?: number;
}

/**
 * Evidence is immutable and deduplicated by hash.
 * Returns existing item if hash already exists.
 */
export async function insertOrGetEvidence(
  db: Db,
  input: InsertEvidenceInput,
): Promise<{ item: EvidenceItemRow; created: boolean }> {
  const existing = await db
    .prepare('SELECT * FROM evidence_items WHERE hash = ? LIMIT 1')
    .bind(input.hash)
    .first<EvidenceItemRow>();
  if (existing) return { item: existing, created: false };

  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO evidence_items
        (id, type, source, title, retrieved_at, hash, storage_ref, mime_type, bytes_len, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .bind(
      id,
      input.type,
      input.source,
      input.title ?? null,
      now,
      input.hash,
      input.storageRef ?? null,
      input.mimeType ?? null,
      input.bytesLen ?? null,
      now,
    )
    .run();

  const item = await db
    .prepare('SELECT * FROM evidence_items WHERE id = ?')
    .bind(id)
    .first<EvidenceItemRow>();
  if (!item) throw new Error('insertOrGetEvidence: row missing');
  return { item, created: true };
}

export async function linkEvidence(
  db: Db,
  evidenceId: string,
  linkType: EvidenceLinkType,
  linkId: string,
): Promise<void> {
  // Idempotent: ignore if already linked
  await db
    .prepare(
      `INSERT OR IGNORE INTO evidence_links (id, evidence_id, link_type, link_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), evidenceId, linkType, linkId, nowIso())
    .run();
}

export async function getEvidenceForLink(
  db: Db,
  linkType: EvidenceLinkType,
  linkId: string,
): Promise<EvidenceItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.* FROM evidence_items e
       JOIN evidence_links el ON el.evidence_id = e.id
       WHERE el.link_type = ? AND el.link_id = ?
       ORDER BY e.created_at ASC`,
    )
    .bind(linkType, linkId)
    .all<EvidenceItemRow>();
  return results;
}

export async function insertDerivedClaim(
  db: Db,
  input: {
    reportVersionId: string;
    claimType: string;
    claim: unknown;
    confidence: number;
    evidenceIds: string[];
  },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO derived_claims
        (id, report_version_id, claim_type, claim_json, confidence, evidence_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.reportVersionId,
      input.claimType,
      JSON.stringify(input.claim),
      input.confidence,
      JSON.stringify(input.evidenceIds),
      nowIso(),
    )
    .run();
  return id;
}

export async function deprecateEvidence(db: Db, id: string): Promise<void> {
  // No deletes; status = deprecated preserves auditability
  await db
    .prepare(`UPDATE evidence_items SET status = 'deprecated' WHERE id = ?`)
    .bind(id)
    .run();
}
