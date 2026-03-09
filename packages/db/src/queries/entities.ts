import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/utils/index.js';

export type EntityType = 'person' | 'org' | 'place';
export type EntityStatus = 'active' | 'merged' | 'archived';
export type MatchTier = 'exact' | 'probable' | 'possible';
export type MatchSuggestionStatus = 'pending' | 'approved' | 'rejected';

export interface EntityRow {
  id: string;
  entity_type: EntityType;
  canonical_name: string;
  city: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface EntityAliasRow {
  id: string;
  entity_id: string;
  alias: string;
  alias_norm: string;
  source_evidence_id: string | null;
  address_norm: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  created_at: string;
}

export async function createEntity(
  db: Db,
  input: {
    entityType: EntityType;
    canonicalName: string;
    city?: string;
  },
): Promise<EntityRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO entities (id, entity_type, canonical_name, city, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(id, input.entityType, input.canonicalName, input.city ?? null, now, now)
    .run();
  const row = await db
    .prepare('SELECT * FROM entities WHERE id = ?')
    .bind(id)
    .first<EntityRow>();
  if (!row) throw new Error('createEntity: row missing');
  return row;
}

export async function getEntityById(db: Db, id: string): Promise<EntityRow | null> {
  return db.prepare('SELECT * FROM entities WHERE id = ?').bind(id).first<EntityRow>();
}

export async function addEntityAlias(
  db: Db,
  input: {
    entityId: string;
    alias: string;
    aliasNorm: string;
    sourceEvidenceId?: string;
    addressNorm?: string;
    phone?: string;
    email?: string;
    website?: string;
  },
): Promise<EntityAliasRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO entity_aliases
        (id, entity_id, alias, alias_norm, source_evidence_id, address_norm, phone, email, website, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.entityId,
      input.alias,
      input.aliasNorm,
      input.sourceEvidenceId ?? null,
      input.addressNorm ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.website ?? null,
      now,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM entity_aliases WHERE id = ?')
    .bind(id)
    .first<EntityAliasRow>();
  // If insert was ignored (alias_norm duplicate), fetch existing
  if (!row) {
    const existing = await db
      .prepare('SELECT * FROM entity_aliases WHERE entity_id = ? AND alias_norm = ?')
      .bind(input.entityId, input.aliasNorm)
      .first<EntityAliasRow>();
    if (!existing) throw new Error('addEntityAlias: row missing');
    return existing;
  }
  return row;
}

export async function findEntitiesByAliasNorm(db: Db, aliasNorm: string): Promise<EntityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.* FROM entities e
       JOIN entity_aliases ea ON ea.entity_id = e.id
       WHERE ea.alias_norm = ? AND e.status = 'active'`,
    )
    .bind(aliasNorm)
    .all<EntityRow>();
  return results;
}

export async function findEntityByIdentifier(
  db: Db,
  idType: string,
  idValue: string,
): Promise<EntityRow | null> {
  return db
    .prepare(
      `SELECT e.* FROM entities e
       JOIN entity_identifiers ei ON ei.entity_id = e.id
       WHERE ei.id_type = ? AND ei.id_value = ? AND e.status = 'active' LIMIT 1`,
    )
    .bind(idType, idValue)
    .first<EntityRow>();
}

export async function addEntityIdentifier(
  db: Db,
  entityId: string,
  idType: string,
  idValue: string,
  sourceEvidenceId?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO entity_identifiers (id, entity_id, id_type, id_value, source_evidence_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), entityId, idType, idValue, sourceEvidenceId ?? null, nowIso())
    .run();
}

export async function createMatchSuggestion(
  db: Db,
  entityAId: string,
  entityBId: string,
  matchTier: MatchTier,
  rule: string,
  confidence: number,
): Promise<void> {
  const [a, b] = entityAId < entityBId ? [entityAId, entityBId] : [entityBId, entityAId];
  const now = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO entity_match_suggestions
        (id, entity_a_id, entity_b_id, match_tier, rule, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(newId(), a, b, matchTier, rule, confidence, now, now)
    .run();
}

export async function listPendingSuggestions(db: Db): Promise<unknown[]> {
  const { results } = await db
    .prepare(
      `SELECT ms.*, ea.canonical_name AS entity_a_name, eb.canonical_name AS entity_b_name
       FROM entity_match_suggestions ms
       JOIN entities ea ON ea.id = ms.entity_a_id
       JOIN entities eb ON eb.id = ms.entity_b_id
       WHERE ms.status = 'pending'
       ORDER BY ms.confidence DESC`,
    )
    .all();
  return results;
}
