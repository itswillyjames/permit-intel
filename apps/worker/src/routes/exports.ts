import type { Db } from '@permit-intel/db/src/client.js';
import { getExportById } from '@permit-intel/db/src/queries/exports.js';
import { renderHtmlExport } from '@permit-intel/export/src/renderers/html.js';
import type { Env } from '../index.js';

/**
 * Exports API
 * - POST /api/exports          -> renders dossier HTML and persists to R2
 * - GET  /api/exports/:id      -> returns export metadata from D1
 * - GET  /api/exports/:id/html -> returns HTML from R2 (durable)
 */
export async function handleExports(req: Request, db: Db, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const exportId = segments[2];
  const sub = segments[3]; // 'html'

  // POST /api/exports -> render html + persist to R2
  if (req.method === 'POST' && !exportId) {
    if (!env.EXPORTS_BUCKET) return json({ error: 'EXPORTS_BUCKET not configured' }, 500);

    const body = (await req.json()) as { report_id: string; report_version_id: string };
    if (!body?.report_id || !body?.report_version_id) {
      return json({ error: 'report_id and report_version_id required' }, 400);
    }

    // R2 storage adapter matching packages/export/src/renderers/html.ts StorageAdapter
    const r2Adapter = {
      async put(key: string, content: string | Uint8Array, mimeType: string): Promise<string> {
        await env.EXPORTS_BUCKET.put(key, content as any, {
          httpMetadata: { contentType: mimeType },
        });
        return `r2:${key}`;
      },
      async get(key: string): Promise<string | null> {
        const obj = await env.EXPORTS_BUCKET.get(key);
        return obj ? await obj.text() : null;
      },
    };

    const id = await renderHtmlExport({
      db,
      reportId: body.report_id,
      reportVersionId: body.report_version_id,
      storageAdapter: r2Adapter,
    });

    return json({ export_id: id }, 201);
  }

  // GET /api/exports/:id/html -> fetch html from R2 using html_storage_ref
  if (req.method === 'GET' && exportId && sub === 'html') {
    if (!env.EXPORTS_BUCKET) return json({ error: 'EXPORTS_BUCKET not configured' }, 500);

    const exportRec = await getExportById(db, exportId);
    if (!exportRec || !exportRec.html_storage_ref) return json({ error: 'Not found' }, 404);

    if (exportRec.html_storage_ref.startsWith('r2:')) {
      const key = exportRec.html_storage_ref.replace(/^r2:/, '');
      const obj = await env.EXPORTS_BUCKET.get(key);
      if (!obj) return json({ error: 'Content not found in R2' }, 404);

      return new Response(await obj.text(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (exportRec.html_storage_ref.startsWith('inline:')) {
      return json(
        {
          error: 'Legacy inline export cannot be retrieved (non-persistent). Re-render the export.',
          hint: 'POST /api/exports again for this report_version_id to persist into R2.',
        },
        409,
      );
    }

    return json({ error: 'Unknown html_storage_ref scheme' }, 500);
  }

  // GET /api/exports/:id -> metadata
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
