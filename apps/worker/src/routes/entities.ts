import type { Db } from '@permit-intel/db/src/client.js';
import {
  getEntityById,
  listPendingSuggestions,
} from '@permit-intel/db/src/queries/entities.js';
import { executeMerge, executeUnmerge } from '@permit-intel/db/src/queries/merge.js';
import type { Env } from '../index.js';

export async function handleEntities(req: Request, db: Db, _env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const entityId = segments[2];
  const sub = segments[3];

  if (req.method === 'GET' && !entityId) {
    const suggestions = await listPendingSuggestions(db);
    return json({ suggestions });
  }

  if (req.method === 'GET' && entityId && !sub) {
    const entity = await getEntityById(db, entityId);
    if (!entity) return json({ error: 'Not found' }, 404);
    return json({ entity });
  }

  if (req.method === 'POST' && sub === 'merge') {
    const body = await req.json() as { winner_id: string; merged_id: string };
    const ledgerId = await executeMerge(db, body.winner_id, body.merged_id, 'operator_manual', 1.0, 'approved');
    return json({ merge_ledger_id: ledgerId }, 201);
  }

  if (req.method === 'POST' && sub === 'unmerge') {
    const body = await req.json() as { merge_ledger_id: string; note?: string };
    await executeUnmerge(db, body.merge_ledger_id, body.note);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
