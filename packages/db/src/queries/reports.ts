import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/src/utils/index';

export type ReportStatus =
  | 'draft' | 'queued' | 'running' | 'partial' | 'completed'
  | 'failed' | 'superseded' | 'archived';

export type ReportVersionStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed';

export interface ReportRow {
  id: string;
  permit_id: string;
  status: ReportStatus;
  active_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportVersionRow {
  id: string;
  report_id: string;
  version: number;
  snapshot_json: string;
  status: ReportVersionStatus;
  created_at: string;
  updated_at: string;
}

export async function createReport(db: Db, permitId: string): Promise<ReportRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO reports (id, permit_id, status, active_version_id, created_at, updated_at)
       VALUES (?, ?, 'draft', NULL, ?, ?)`,
    )
    .bind(id, permitId, now, now)
    .run();
  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>();
  if (!row) throw new Error('createReport: row missing after insert');
  return row;
}

export async function getReportById(db: Db, id: string): Promise<ReportRow | null> {
  return db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>();
}

export async function getReportByPermitId(db: Db, permitId: string): Promise<ReportRow | null> {
  return db
    .prepare('SELECT * FROM reports WHERE permit_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(permitId)
    .first<ReportRow>();
}

export async function updateReportStatus(
  db: Db,
  id: string,
  status: ReportStatus,
  activeVersionId?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE reports SET status = ?, active_version_id = COALESCE(?, active_version_id), updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, activeVersionId ?? null, nowIso(), id)
    .run();
}

export async function createReportVersion(
  db: Db,
  reportId: string,
  snapshot: unknown,
): Promise<ReportVersionRow> {
  // Get next version number
  const last = await db
    .prepare('SELECT MAX(version) as max_version FROM report_versions WHERE report_id = ?')
    .bind(reportId)
    .first<{ max_version: number | null }>();
  const version = (last?.max_version ?? 0) + 1;

  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO report_versions (id, report_id, version, snapshot_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .bind(id, reportId, version, JSON.stringify(snapshot), now, now)
    .run();

  const row = await db
    .prepare('SELECT * FROM report_versions WHERE id = ?')
    .bind(id)
    .first<ReportVersionRow>();
  if (!row) throw new Error('createReportVersion: row missing after insert');
  return row;
}

export async function getReportVersion(db: Db, id: string): Promise<ReportVersionRow | null> {
  return db.prepare('SELECT * FROM report_versions WHERE id = ?').bind(id).first<ReportVersionRow>();
}

export async function updateReportVersionStatus(
  db: Db,
  id: string,
  status: ReportVersionStatus,
): Promise<void> {
  await db
    .prepare('UPDATE report_versions SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowIso(), id)
    .run();
}

export async function appendReportEvent(
  db: Db,
  reportVersionId: string,
  eventType: string,
  payload?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO report_events (id, report_version_id, event_type, event_payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), reportVersionId, eventType, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

export async function listReports(
  db: Db,
  filter: { status?: ReportStatus; limit?: number; offset?: number } = {},
): Promise<ReportRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.status) { conditions.push('status = ?'); values.push(filter.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(filter.limit ?? 50, filter.offset ?? 0);
  const { results } = await db
    .prepare(`SELECT * FROM reports ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...values)
    .all<ReportRow>();
  return results;
}
