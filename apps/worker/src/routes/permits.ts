import type { Db } from '@permit-intel/db/src/client.js';
import {
  listPermits,
  getPermitById,
  updatePermitStatus,
  appendPermitEvent,
} from '@permit-intel/db/src/queries/permits.js';
import type { Env } from '../index.js';

export async function handlePermits(req: Request, db: Db, _env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const permitId = segments[2]; // /api/permits/{id}

  if (req.method === 'GET' && !permitId) {
    // List permits with filters
    const city = url.searchParams.get('city') ?? undefined;
    const status = url.searchParams.get('status') as any ?? undefined;
    const minScore = url.searchParams.get('min_score') ? parseFloat(url.searchParams.get('min_score')!) : undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50');
    const offset = parseInt(url.searchParams.get('offset') ?? '0');

    const permits = await listPermits(db, { city, status, minScore, limit, offset });
    return json({ permits, count: permits.length });
  }

  if (req.method === 'GET' && permitId) {
    const permit = await getPermitById(db, permitId);
    if (!permit) return json({ error: 'Not found' }, 404);
    return json({ permit });
  }

  if (req.method === 'PUT' && permitId) {
    // Update permit status
    const body = await req.json() as { status?: string };
    if (body.status) {
      await updatePermitStatus(db, permitId, body.status as any);
      await appendPermitEvent(db, permitId, 'status.updated', { status: body.status });
    }
    const permit = await getPermitById(db, permitId);
    return json({ permit });
  }

  return json({ error: 'Method not allowed' }, 405);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
