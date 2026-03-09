import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/utils/index.js';

export type ExportType = 'dossier' | 'playbook' | 'bundle';
export type ExportStatus = 'draft' | 'rendering' | 'ready' | 'delivered' | 'failed';

export interface ExportRow {
  id: string;
  report_version_id: string;
  export_type: ExportType;
  template_version: string;
  status: ExportStatus;
  html_storage_ref: string | null;
  pdf_storage_ref: string | null;
  checksum_html: string | null;
  checksum_pdf: string | null;
  created_at: string;
  updated_at: string;
}

export async function createExport(
  db: Db,
  input: {
    reportVersionId: string;
    exportType: ExportType;
    templateVersion: string;
  },
): Promise<ExportRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exports
        (id, report_version_id, export_type, template_version, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .bind(id, input.reportVersionId, input.exportType, input.templateVersion, now, now)
    .run();
  const row = await db
    .prepare('SELECT * FROM exports WHERE id = ?')
    .bind(id)
    .first<ExportRow>();
  if (!row) throw new Error('createExport: row missing');
  return row;
}

export async function updateExport(
  db: Db,
  id: string,
  update: Partial<{
    status: ExportStatus;
    html_storage_ref: string;
    pdf_storage_ref: string;
    checksum_html: string;
    checksum_pdf: string;
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
    .prepare(`UPDATE exports SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getExportById(db: Db, id: string): Promise<ExportRow | null> {
  return db.prepare('SELECT * FROM exports WHERE id = ?').bind(id).first<ExportRow>();
}

export async function appendExportEvent(
  db: Db,
  exportId: string,
  eventType: string,
  payload?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO export_events (id, export_id, event_type, event_payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), exportId, eventType, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}
