/**
 * Entity resolution service.
 * Deterministic canonicalization → suggestion generation → safe merge flow.
 */
import type { Db } from '@permit-intel/db/src/client.js';
import {
  createEntity,
  addEntityAlias,
  addEntityIdentifier,
  findEntitiesByAliasNorm,
  findEntityByIdentifier,
  createMatchSuggestion,
  type EntityType,
} from '@permit-intel/db/src/queries/entities.js';
import { executeMerge, executeUnmerge } from '@permit-intel/db/src/queries/merge.js';
import { normalizeName, stringSimilarity, logger } from '@permit-intel/shared/src/utils/index.js';
import type { EntityExtractOutput } from '@permit-intel/shared/src/schemas/stages.js';

export interface EntityResolutionResult {
  entityId: string;
  created: boolean;
  matchTier: 'new' | 'exact' | 'probable' | 'possible';
}

/** Thresholds */
const EXACT_NAME_THRESHOLD = 0.95;
const PROBABLE_NAME_THRESHOLD = 0.85;

/**
 * Resolve extracted entities from a stage output.
 * Creates entities, aliases, identifiers, and queues suggestions.
 */
export async function resolveExtractedEntities(
  db: Db,
  extractOutput: EntityExtractOutput,
  reportVersionId: string,
): Promise<EntityResolutionResult[]> {
  const results: EntityResolutionResult[] = [];

  for (const extracted of extractOutput.entities) {
    const result = await resolveOneEntity(db, {
      entityType: roleToEntityType(extracted.role),
      nameRaw: extracted.name_raw,
      nameNorm: extracted.name_norm,
      addressNorm: extracted.address_norm ?? undefined,
      identifiers: extracted.identifiers,
    });
    results.push(result);
  }

  return results;
}

export interface ResolveEntityInput {
  entityType: EntityType;
  nameRaw: string;
  nameNorm: string;
  addressNorm?: string;
  identifiers?: Array<{ type: string; value: string }>;
  sourceEvidenceId?: string;
}

export async function resolveOneEntity(
  db: Db,
  input: ResolveEntityInput,
): Promise<EntityResolutionResult> {
  const aliasNorm = normalizeName(input.nameNorm);

  // 1. Check strong identifiers first (exact match)
  for (const ident of input.identifiers ?? []) {
    const existing = await findEntityByIdentifier(db, ident.type, ident.value);
    if (existing) {
      // Add alias if not present
      await addEntityAlias(db, {
        entityId: existing.id,
        alias: input.nameRaw,
        aliasNorm,
        addressNorm: input.addressNorm,
        sourceEvidenceId: input.sourceEvidenceId,
      });
      logger.info('Entity resolved via identifier', {
        entity_id: existing.id,
        id_type: ident.type,
        id_value: ident.value,
      });
      return { entityId: existing.id, created: false, matchTier: 'exact' };
    }
  }

  // 2. Check normalized name
  const nameMatches = await findEntitiesByAliasNorm(db, aliasNorm);
  if (nameMatches.length > 0) {
    // All are exact name matches
    const best = nameMatches[0]!;
    await addEntityAlias(db, {
      entityId: best.id,
      alias: input.nameRaw,
      aliasNorm,
      addressNorm: input.addressNorm,
      sourceEvidenceId: input.sourceEvidenceId,
    });
    return { entityId: best.id, created: false, matchTier: 'exact' };
  }

  // 3. Fuzzy name match via all active aliases
  // (In production: use a dedicated search index; for MVP, we do a full scan of recent entities)
  // For now: create new entity and queue suggestion based on similarity scan
  const entity = await createEntity(db, {
    entityType: input.entityType,
    canonicalName: input.nameNorm,
  });

  await addEntityAlias(db, {
    entityId: entity.id,
    alias: input.nameRaw,
    aliasNorm,
    addressNorm: input.addressNorm,
    sourceEvidenceId: input.sourceEvidenceId,
  });

  // Add identifiers
  for (const ident of input.identifiers ?? []) {
    await addEntityIdentifier(db, entity.id, ident.type, ident.value, input.sourceEvidenceId);
  }

  // Scan for probable matches (fuzzy — in production use FTS; here brute-force of recent)
  await findAndQueueFuzzyMatches(db, entity.id, aliasNorm);

  return { entityId: entity.id, created: true, matchTier: 'new' };
}

async function findAndQueueFuzzyMatches(
  db: Db,
  newEntityId: string,
  newAliasNorm: string,
): Promise<void> {
  // Get recent active entities (last 1000 for MVP)
  const { results: recentAliases } = await db
    .prepare(
      `SELECT ea.entity_id, ea.alias_norm FROM entity_aliases ea
       JOIN entities e ON e.id = ea.entity_id
       WHERE e.status = 'active' AND e.id != ?
       ORDER BY ea.created_at DESC LIMIT 1000`,
    )
    .bind(newEntityId)
    .all<{ entity_id: string; alias_norm: string }>();

  for (const row of recentAliases) {
    const similarity = stringSimilarity(newAliasNorm, row.alias_norm);
    if (similarity >= EXACT_NAME_THRESHOLD) {
      // Already handled by exact match above; skip
    } else if (similarity >= PROBABLE_NAME_THRESHOLD) {
      await createMatchSuggestion(db, newEntityId, row.entity_id, 'probable', 'fuzzy_name', similarity);
    }
    // Below threshold: ignore
  }
}

function roleToEntityType(role: string): EntityType {
  switch (role) {
    case 'owner': return 'org';
    case 'contractor': return 'org';
    case 'architect': return 'org';
    case 'engineer': return 'org';
    case 'applicant': return 'person';
    default: return 'org';
  }
}

/** Operator-confirmed merge */
export async function operatorMerge(
  db: Db,
  winnerId: string,
  mergedId: string,
): Promise<string> {
  return executeMerge(db, winnerId, mergedId, 'operator_manual', 1.0, 'approved');
}

/** Operator unmerge */
export async function operatorUnmerge(
  db: Db,
  mergeLedgerId: string,
  note?: string,
): Promise<void> {
  return executeUnmerge(db, mergeLedgerId, note);
}
