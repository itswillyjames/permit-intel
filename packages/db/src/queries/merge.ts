import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/src/utils/index';

export type OperatorDecision = 'approved' | 'rejected';

export interface MergeDiff {
  aliasesMoved: string[];
  identifiersMoved: string[];
  linksRepointed: string[];
  mergedEntityPreviousStatus: string;
}

/**
 * Merge entity B into entity A (winner).
 * Must be called inside a transaction (caller responsibility in D1).
 */
export async function executeMerge(
  db: Db,
  winnerId: string,
  mergedId: string,
  rule: string,
  confidence: number,
  operatorDecision: OperatorDecision,
): Promise<string> {
  const now = nowIso();

  // Capture diff before merge
  const { results: aliases } = await db
    .prepare('SELECT id FROM entity_aliases WHERE entity_id = ?')
    .bind(mergedId)
    .all<{ id: string }>();
  const { results: identifiers } = await db
    .prepare('SELECT id FROM entity_identifiers WHERE entity_id = ?')
    .bind(mergedId)
    .all<{ id: string }>();
  const { results: linksFrom } = await db
    .prepare('SELECT id FROM entity_links WHERE from_entity_id = ?')
    .bind(mergedId)
    .all<{ id: string }>();
  const { results: linksTo } = await db
    .prepare('SELECT id FROM entity_links WHERE to_entity_id = ?')
    .bind(mergedId)
    .all<{ id: string }>();

  const mergedEntity = await db
    .prepare('SELECT status FROM entities WHERE id = ?')
    .bind(mergedId)
    .first<{ status: string }>();

  const diff: MergeDiff = {
    aliasesMoved: aliases.map((a) => a.id),
    identifiersMoved: identifiers.map((i) => i.id),
    linksRepointed: [...linksFrom.map((l) => l.id), ...linksTo.map((l) => l.id)],
    mergedEntityPreviousStatus: mergedEntity?.status ?? 'active',
  };

  // Check for locks before proceeding
  const lock = await db
    .prepare(`SELECT id FROM operator_locks WHERE lock_type = 'entity' AND lock_id = ?`)
    .bind(mergedId)
    .first<{ id: string }>();
  if (lock) throw new Error(`Entity ${mergedId} is locked and cannot be merged`);

  // Move aliases
  await db
    .prepare('UPDATE entity_aliases SET entity_id = ? WHERE entity_id = ?')
    .bind(winnerId, mergedId)
    .run();

  // Move identifiers (skip conflicts due to UNIQUE constraint)
  await db
    .prepare(
      `UPDATE OR IGNORE entity_identifiers SET entity_id = ? WHERE entity_id = ?`,
    )
    .bind(winnerId, mergedId)
    .run();

  // Repoint links
  await db
    .prepare('UPDATE entity_links SET from_entity_id = ? WHERE from_entity_id = ?')
    .bind(winnerId, mergedId)
    .run();
  await db
    .prepare('UPDATE entity_links SET to_entity_id = ? WHERE to_entity_id = ?')
    .bind(winnerId, mergedId)
    .run();

  // Mark merged entity
  await db
    .prepare(`UPDATE entities SET status = 'merged', updated_at = ? WHERE id = ?`)
    .bind(now, mergedId)
    .run();

  // Write merge ledger
  const ledgerId = newId();
  await db
    .prepare(
      `INSERT INTO merge_ledger
        (id, winner_entity_id, merged_entity_id, rule, confidence, operator_decision, diff_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ledgerId, winnerId, mergedId, rule, confidence, operatorDecision, JSON.stringify(diff), now)
    .run();

  return ledgerId;
}

/**
 * Unmerge using ledger diff — restores previous state.
 */
export async function executeUnmerge(
  db: Db,
  mergeLedgerId: string,
  operatorNote?: string,
): Promise<void> {
  const ledger = await db
    .prepare('SELECT * FROM merge_ledger WHERE id = ?')
    .bind(mergeLedgerId)
    .first<{
      winner_entity_id: string;
      merged_entity_id: string;
      diff_json: string;
    }>();
  if (!ledger) throw new Error(`Merge ledger ${mergeLedgerId} not found`);

  const diff: MergeDiff = JSON.parse(ledger.diff_json);
  const now = nowIso();

  // Restore merged entity status
  await db
    .prepare(`UPDATE entities SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(diff.mergedEntityPreviousStatus, now, ledger.merged_entity_id)
    .run();

  // Move aliases back
  if (diff.aliasesMoved.length > 0) {
    const placeholders = diff.aliasesMoved.map(() => '?').join(',');
    await db
      .prepare(`UPDATE entity_aliases SET entity_id = ? WHERE id IN (${placeholders})`)
      .bind(ledger.merged_entity_id, ...diff.aliasesMoved)
      .run();
  }

  // Move identifiers back
  if (diff.identifiersMoved.length > 0) {
    const placeholders = diff.identifiersMoved.map(() => '?').join(',');
    await db
      .prepare(`UPDATE entity_identifiers SET entity_id = ? WHERE id IN (${placeholders})`)
      .bind(ledger.merged_entity_id, ...diff.identifiersMoved)
      .run();
  }

  // Repoint links back
  if (diff.linksRepointed.length > 0) {
    const placeholders = diff.linksRepointed.map(() => '?').join(',');
    await db
      .prepare(`UPDATE entity_links SET from_entity_id = ? WHERE from_entity_id = ? AND id IN (${placeholders})`)
      .bind(ledger.merged_entity_id, ledger.winner_entity_id, ...diff.linksRepointed)
      .run();
    await db
      .prepare(`UPDATE entity_links SET to_entity_id = ? WHERE to_entity_id = ? AND id IN (${placeholders})`)
      .bind(ledger.merged_entity_id, ledger.winner_entity_id, ...diff.linksRepointed)
      .run();
  }

  // Write unmerge ledger
  await db
    .prepare(
      `INSERT INTO unmerge_ledger (id, merge_ledger_id, operator_note, diff_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), mergeLedgerId, operatorNote ?? null, diff_json_snapshot(diff), now)
    .run();
}

function diff_json_snapshot(diff: MergeDiff): string {
  return JSON.stringify(diff);
}
