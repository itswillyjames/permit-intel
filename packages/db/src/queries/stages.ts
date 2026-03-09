import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/utils/index.js';

export type StageAttemptStatus =
  | 'queued' | 'running' | 'succeeded' | 'retrying'
  | 'failed_retryable' | 'failed_terminal' | 'skipped';

export interface StageAttemptRow {
  id: string;
  report_version_id: string;
  stage_name: string;
  status: StageAttemptStatus;
  idempotency_key: string;
  provider: string | null;
  model_id: string | null;
  attempt_no: number;
  input_hash: string;
  started_at: string | null;
  finished_at: string | null;
  error_class: string | null;
  error_message: string | null;
  metrics_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageOutputRow {
  id: string;
  stage_attempt_id: string;
  output_json: string;
  output_hash: string;
  created_at: string;
}

/**
 * Create a stage attempt with idempotency guard.
 * If a row with (report_version_id, stage_name, idempotency_key) exists, return it.
 */
export async function getOrCreateStageAttempt(
  db: Db,
  input: {
    reportVersionId: string;
    stageName: string;
    idempotencyKey: string;
    inputHash: string;
  },
): Promise<{ attempt: StageAttemptRow; created: boolean }> {
  // Check for existing
  const existing = await db
    .prepare(
      `SELECT * FROM stage_attempts
       WHERE report_version_id = ? AND stage_name = ? AND idempotency_key = ?`,
    )
    .bind(input.reportVersionId, input.stageName, input.idempotencyKey)
    .first<StageAttemptRow>();
  if (existing) return { attempt: existing, created: false };

  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO stage_attempts
        (id, report_version_id, stage_name, status, idempotency_key, attempt_no, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.reportVersionId, input.stageName, input.idempotencyKey, input.inputHash, now, now)
    .run();

  const attempt = await db
    .prepare('SELECT * FROM stage_attempts WHERE id = ?')
    .bind(id)
    .first<StageAttemptRow>();
  if (!attempt) throw new Error('getOrCreateStageAttempt: row missing');
  return { attempt, created: true };
}

export async function getStageAttempt(db: Db, id: string): Promise<StageAttemptRow | null> {
  return db.prepare('SELECT * FROM stage_attempts WHERE id = ?').bind(id).first<StageAttemptRow>();
}

export async function getStageAttemptsByVersion(
  db: Db,
  reportVersionId: string,
): Promise<StageAttemptRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM stage_attempts WHERE report_version_id = ? ORDER BY created_at ASC')
    .bind(reportVersionId)
    .all<StageAttemptRow>();
  return results;
}

export async function updateStageAttempt(
  db: Db,
  id: string,
  update: Partial<{
    status: StageAttemptStatus;
    provider: string;
    model_id: string;
    attempt_no: number;
    started_at: string;
    finished_at: string;
    error_class: string;
    error_message: string;
    metrics_json: string;
  }>,
): Promise<void> {
  const fields = Object.entries(update)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`);
  const values = Object.values(update).filter((v) => v !== undefined);
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(nowIso(), id);
  await db
    .prepare(`UPDATE stage_attempts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function saveStageOutput(
  db: Db,
  stageAttemptId: string,
  outputJson: string,
  outputHash: string,
): Promise<StageOutputRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO stage_outputs (id, stage_attempt_id, output_json, output_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, stageAttemptId, outputJson, outputHash, now)
    .run();
  return { id, stage_attempt_id: stageAttemptId, output_json: outputJson, output_hash: outputHash, created_at: now };
}

export async function getStageOutput(
  db: Db,
  stageAttemptId: string,
): Promise<StageOutputRow | null> {
  return db
    .prepare('SELECT * FROM stage_outputs WHERE stage_attempt_id = ? LIMIT 1')
    .bind(stageAttemptId)
    .first<StageOutputRow>();
}

export async function appendStageEvent(
  db: Db,
  stageAttemptId: string,
  eventType: string,
  payload?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stage_events (id, stage_attempt_id, event_type, event_payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), stageAttemptId, eventType, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

export async function getSucceededOutput(
  db: Db,
  reportVersionId: string,
  stageName: string,
): Promise<StageOutputRow | null> {
  const attempt = await db
    .prepare(
      `SELECT id FROM stage_attempts
       WHERE report_version_id = ? AND stage_name = ? AND status = 'succeeded'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(reportVersionId, stageName)
    .first<{ id: string }>();
  if (!attempt) return null;
  return getStageOutput(db, attempt.id);
}
