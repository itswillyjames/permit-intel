import type { Db } from '../client.js';
import { newId, nowIso } from '@permit-intel/shared/src/utils/index';

export type ExportType = 'dossier' | 'playbook' | 'bundle' | 'lead_asset';
export type ExportStatus = 'draft' | 'rendering' | 'ready' | 'delivered' | 'failed';
export type LeadAssetType = 'lead_dossier_full' | 'teaser_marketing' | 'strategy_playbook' | 'buyer_list';

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
  permit_id: string | null;
  asset_type: LeadAssetType | null;
  asset_format: string | null;
  storage_ref: string | null;
  content_type: string | null;
  file_name: string | null;
  metadata_json: string | null;
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

export async function createLeadAssetExport(
  db: Db,
  input: {
    reportVersionId: string;
    permitId: string;
    assetType: LeadAssetType;
    format: 'md' | 'html' | 'json' | 'csv';
    contentType: string;
    fileName: string;
    storageRef: string;
    metadata?: unknown;
    htmlStorageRef?: string;
  },
): Promise<ExportRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exports
        (id, report_version_id, export_type, template_version, status, permit_id, asset_type, asset_format, storage_ref, html_storage_ref, content_type, file_name, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'lead_asset', 'v1', 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.reportVersionId,
      input.permitId,
      input.assetType,
      input.format,
      input.storageRef,
      input.htmlStorageRef ?? null,
      input.contentType,
      input.fileName,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    )
    .run();

  const row = await db.prepare('SELECT * FROM exports WHERE id = ?').bind(id).first<ExportRow>();
  if (!row) throw new Error('createLeadAssetExport: row missing');
  return row;
}

export async function listLeadAssetsByPermit(db: Db, permitId: string): Promise<ExportRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*
       FROM exports e
       WHERE e.id IN (
         SELECT e2.id
         FROM exports e2
         WHERE e2.permit_id = ? AND e2.export_type = 'lead_asset'
           AND e2.asset_type = e.asset_type
         ORDER BY e2.created_at DESC, e2.id DESC
         LIMIT 1
       )
       AND e.permit_id = ?
       AND e.export_type = 'lead_asset'
       ORDER BY CASE e.asset_type
         WHEN 'lead_dossier_full' THEN 1
         WHEN 'teaser_marketing' THEN 2
         WHEN 'strategy_playbook' THEN 3
         WHEN 'buyer_list' THEN 4
         ELSE 99 END`,
    )
    .bind(permitId, permitId)
    .all<ExportRow>();
  return results;
}

export async function getLeadAssetById(db: Db, id: string): Promise<ExportRow | null> {
  return db
    .prepare(`SELECT * FROM exports WHERE id = ? AND export_type = 'lead_asset'`)
    .bind(id)
    .first<ExportRow>();
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
