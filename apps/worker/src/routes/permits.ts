import type { Db } from '@permit-intel/db/src/client.js';
import {
  listPermits,
  getPermitById,
  updatePermitStatus,
  appendPermitEvent,
  upsertPermit,
  insertPermitSource,
} from '@permit-intel/db/src/queries/permits.js';
import type { Env } from '../index.js';
import { normalizeAddress } from '@permit-intel/shared/src/utils/index.js';

type RawRow = Record<string, unknown>;

export async function handlePermits(req: Request, db: Db, _env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const permitId = segments[2]; // /api/permits/{id}

  // POST /api/permits/ingest?city=chicago|seattle&limit=...&offset=...&since=YYYY-MM-DD
  if (req.method === 'POST' && permitId === 'ingest') {
    const city = (url.searchParams.get('city') || '').toLowerCase();
    const limit = clampInt(url.searchParams.get('limit'), 1, 1000, 200);
    const offset = clampInt(url.searchParams.get('offset'), 0, 1_000_000, 0);
    const since = url.searchParams.get('since') || defaultSince30d();

    if (!city) return json({ error: 'MISSING_CITY', detail: 'Provide ?city=chicago|seattle' }, 400);
    if (city !== 'chicago' && city !== 'seattle') {
      return json({ error: 'UNSUPPORTED_CITY', detail: 'Supported: chicago, seattle' }, 400);
    }

    const { sourceName, sourceUrl, rows } = await fetchCityPermits({
      city: city as 'chicago' | 'seattle',
      limit,
      offset,
      since,
    });

    let upserted = 0;
    let sourcesInserted = 0;
    let skipped = 0;
    const errors: Array<{ i: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]!;
      try {
        const normalized = normalizeRow(city as 'chicago' | 'seattle', raw);
        if (!normalized) {
          skipped++;
          continue;
        }

        const permit = await upsertPermit(db, normalized);
        upserted++;

        const hash = await sha256Hex(JSON.stringify(raw));
        await insertPermitSource(db, {
          permitId: permit.id,
          sourceName,
          sourceUrl,
          rawPayload: raw,
          hash,
        });
        sourcesInserted++;
      } catch (e) {
        errors.push({ i, reason: String(e) });
      }
    }

    return json({
      ok: true,
      city,
      sourceName,
      sourceUrl,
      requested: { limit, offset, since },
      fetched_rows: rows.length,
      upserted,
      sourcesInserted,
      skipped,
      errors: errors.slice(0, 10),
    });
  }

  if (req.method === 'GET' && !permitId) {
    const city = url.searchParams.get('city') ?? undefined;
    const status = (url.searchParams.get('status') as any) ?? undefined;
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
    const body = (await req.json()) as { status?: string };
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

function clampInt(v: string | null, min: number, max: number, def: number): number {
  if (!v) return def;
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function defaultSince30d(): string {
  const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0]!;
}

async function fetchCityPermits(args: {
  city: 'chicago' | 'seattle';
  limit: number;
  offset: number;
  since: string;
}): Promise<{ sourceName: string; sourceUrl: string; rows: RawRow[] }> {
  if (args.city === 'chicago') {
    const base = 'https://data.cityofchicago.org/resource/ydr8-5enu.json';
    const where = `application_start_date>='${args.since}'`;
    const full = `${base}?$limit=${args.limit}&$offset=${args.offset}&$where=${encodeURIComponent(where)}&$order=application_start_date DESC`;
    const res = await fetch(full);
    if (!res.ok) throw new Error(`Chicago ingest fetch failed: ${res.status}`);
    const rows = (await res.json()) as RawRow[];
    return { sourceName: 'chicago_data_portal', sourceUrl: full, rows };
  }

  const base = 'https://data.seattle.gov/resource/ht3q-kdvx.json';
  const full = `${base}?$limit=${args.limit}&$offset=${args.offset}&$order=applicationdate DESC`;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`Seattle ingest fetch failed: ${res.status}`);
  const rows = (await res.json()) as RawRow[];
  return { sourceName: 'seattle_open_data', sourceUrl: full, rows };
}

function normalizeDate(raw: unknown): string | null {
  if (!raw) return null;
  try {
    const d = new Date(String(raw));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0]!;
  } catch {
    return null;
  }
}

function parseValuation(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n =
    typeof raw === 'number'
      ? raw
      : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return null;
  return Math.round(n);
}

function normalizeRow(city: 'chicago' | 'seattle', raw: RawRow) {
  if (city === 'chicago') {
    const sourcePermitId = String(raw['id'] ?? raw['permit_'] ?? raw['permit_number'] ?? '').trim();
    if (!sourcePermitId) return null;

    const addressRaw =
      String(raw['street_number'] ?? '') +
      ' ' +
      String(raw['street_direction'] ?? '') +
      ' ' +
      String(raw['street_name'] ?? '') +
      ' ' +
      String(raw['suffix'] ?? '');

    const addressNorm = normalizeAddress(
      [raw['street_number'], raw['street_direction'], raw['street_name'], raw['suffix']]
        .filter(Boolean)
        .join(' '),
    );

    return {
      city: 'chicago',
      source_permit_id: sourcePermitId,
      filed_date: normalizeDate(raw['application_start_date']),
      issued_date: normalizeDate(raw['issue_date']),
      address_raw: addressRaw.trim() || null,
      address_norm: addressNorm || null,
      work_type: String(raw['permit_type'] ?? raw['work_description'] ?? '').trim() || null,
      description_raw: String(raw['work_description'] ?? '').trim() || null,
      valuation: parseValuation(raw['reported_cost']),
      applicant_raw: String(raw['contact_1_name'] ?? '').trim() || null,
      contractor_raw: String(raw['contact_1_name'] ?? '').trim() || null,
      owner_raw: String(raw['contact_1_name'] ?? '').trim() || null,
    };
  }

  const sourcePermitId = String(raw['permitnum'] ?? raw['application_permit_number'] ?? '').trim();
  if (!sourcePermitId) return null;

  const addr = String(raw['originaladdress1'] ?? '').trim();
  return {
    city: 'seattle',
    source_permit_id: sourcePermitId,
    filed_date: normalizeDate(raw['applicationdate']),
    issued_date: normalizeDate(raw['issueddate']),
    address_raw: addr || null,
    address_norm: addr ? normalizeAddress(addr) : null,
    work_type: String(raw['permitclassmapped'] ?? raw['permitclass'] ?? '').trim() || null,
    description_raw: String(raw['description'] ?? '').trim() || null,
    valuation: parseValuation(raw['estprojectcost']),
    applicant_raw: String(raw['applicantname'] ?? '').trim() || null,
    contractor_raw: String(raw['contractorcompanyname'] ?? '').trim() || null,
    owner_raw: String(raw['ownername'] ?? '').trim() || null,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}
