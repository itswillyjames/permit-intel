import type { Db } from '@permit-intel/db/src/client.js';
import { getExportById } from '@permit-intel/db/src/queries/exports.js';
import { renderHtmlExport, InMemoryStorage } from '@permit-intel/export/src/renderers/html.js';
import type { Env } from '../index.js';

// In-memory storage singleton (Workers restart resets it; use R2 for persistence)
const memStorage = new InMemoryStorage();

export async function handleExports(req: Request, db: Db, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const exportId = segments[2];
  const sub = segments[3]; // 'html', 'pdf'

  if (req.method === 'POST' && !exportId) {
    const body = await req.json() as { report_id: string; report_version_id: string };
    const id = await renderHtmlExport({
      db,
      reportId: body.report_id,
      reportVersionId: body.report_version_id,
      storageAdapter: memStorage,
    });
    return json({ export_id: id }, 201);
  }

  if (req.method === 'GET' && exportId && sub === 'html') {
    const exportRec = await getExportById(db, exportId);
    if (!exportRec || !exportRec.html_storage_ref) return json({ error: 'Not found' }, 404);
    const key = exportRec.html_storage_ref.replace('inline:', '');
    const html = memStorage.getSync(key);
    if (!html) return json({ error: 'Content not found in storage' }, 404);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (req.method === 'GET' && exportId) {
    const exportRec = await getExportById(db, exportId);
    if (!exportRec) return json({ error: 'Not found' }, 404);
    return json({ export: exportRec });
  }

  return json({ error: 'Not found' }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
