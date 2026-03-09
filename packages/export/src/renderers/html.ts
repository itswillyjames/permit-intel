import type { Db } from '@permit-intel/db/src/client.js';
import {
  createExport,
  updateExport,
  appendExportEvent,
} from '@permit-intel/db/src/queries/exports.js';
import { getSucceededOutput } from '@permit-intel/db/src/queries/stages.js';
import { ExportStateMachine } from '@permit-intel/shared/src/state-machine.js';
import { sha256, nowIso, logger } from '@permit-intel/shared/src/utils/index.js';
import { renderDossierHtml, TEMPLATE_VERSION } from '../templates/dossier.js';
import type { DossierComposeOutput } from '@permit-intel/shared/src/schemas/stages.js';

export interface RenderHtmlOptions {
  db: Db;
  reportId: string;
  reportVersionId: string;
  storageAdapter?: StorageAdapter;
}

export interface StorageAdapter {
  put(key: string, content: string | Uint8Array, mimeType: string): Promise<string>;
  get(key: string): Promise<string | null>;
}

/** In-memory storage adapter for local dev / tests */
export class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();
  async put(key: string, content: string | Uint8Array): Promise<string> {
    const s = typeof content === 'string' ? content : Buffer.from(content).toString('utf-8');
    this.store.set(key, s);
    return `inline:${key}`;
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  getSync(key: string): string | undefined {
    return this.store.get(key);
  }
}

export async function renderHtmlExport(opts: RenderHtmlOptions): Promise<string> {
  const { db, reportId, reportVersionId, storageAdapter } = opts;
  const storage = storageAdapter ?? new InMemoryStorage();

  // Get dossier_compose output
  const dossierRow = await getSucceededOutput(db, reportVersionId, 'dossier_compose');
  if (!dossierRow) throw new Error(`No succeeded dossier_compose output for ${reportVersionId}`);
  const dossierOutput = JSON.parse(dossierRow.output_json) as DossierComposeOutput;

  // Create export record
  const exportRec = await createExport(db, {
    reportVersionId,
    exportType: 'bundle',
    templateVersion: TEMPLATE_VERSION,
  });

  ExportStateMachine.assertValid('draft', 'rendering');
  await updateExport(db, exportRec.id, { status: 'rendering' });
  await appendExportEvent(db, exportRec.id, 'export.rendering_started');

  const renderedAt = nowIso();
  const html = renderDossierHtml(dossierOutput, {
    reportVersionId,
    exportId: exportRec.id,
    renderedAt,
    templateVersion: TEMPLATE_VERSION,
  });

  const checksumHtml = sha256(html);
  const storageKey = `exports/${exportRec.id}/dossier.html`;
  const htmlRef = await storage.put(storageKey, html, 'text/html');

  ExportStateMachine.assertValid('rendering', 'ready');
  await updateExport(db, exportRec.id, {
    status: 'ready',
    html_storage_ref: htmlRef,
    checksum_html: checksumHtml,
  });
  await appendExportEvent(db, exportRec.id, 'export.ready', {
    checksum_html: checksumHtml,
    bytes: html.length,
  });

  logger.info('HTML export ready', {
    report_id: reportId,
    report_version_id: reportVersionId,
    export_id: exportRec.id,
    bytes: html.length,
    checksum: checksumHtml,
  });

  return exportRec.id;
}
