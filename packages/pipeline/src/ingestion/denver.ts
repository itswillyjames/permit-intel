import type { CityAdapter, RawPermitRow } from './adapter.js';
import type { UpsertPermitInput } from '@permit-intel/db/src/queries/permits.js';
import { normalizeAddress } from '@permit-intel/shared/src/utils/index.js';

/** Denver building permits — Denver Open Data Catalog */
export class DenverAdapter implements CityAdapter {
  readonly city = 'denver';
  readonly sourceName = 'denver_open_data';
  private readonly baseUrl = 'https://data.denvergov.org/resource/3ey5-qxun.json';

  async fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }> {
    const since = cursor ?? '2020-01-01T00:00:00.000';
    const url = `${this.baseUrl}?$where=issued_date>'${since}'&$order=issued_date ASC&$limit=500`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Denver fetch failed: ${resp.status}`);
    const rows: RawPermitRow[] = await resp.json();
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1]!['issued_date'] ?? since) : null;
    return { rows, nextCursor };
  }

  normalize(raw: RawPermitRow): UpsertPermitInput | null {
    const id = String(raw['permit_no'] ?? raw['permitno'] ?? '').trim();
    if (!id) return null;
    const address = String(raw['address'] ?? '').trim();
    const valuation = parseFloat(String(raw['declared_valuation'] ?? '0')) || null;
    return {
      city: this.city,
      source_permit_id: id,
      filed_date: normalizeDate(String(raw['application_date'] ?? '')),
      issued_date: normalizeDate(String(raw['issued_date'] ?? '')),
      address_raw: address || null,
      address_norm: address ? normalizeAddress(address) : null,
      work_type: String(raw['work_type'] ?? raw['permit_type'] ?? '').trim() || null,
      description_raw: String(raw['description'] ?? '').trim() || null,
      valuation: valuation ? Math.round(valuation) : null,
      applicant_raw: String(raw['applicant'] ?? '').trim() || null,
      contractor_raw: String(raw['contractor_name'] ?? '').trim() || null,
      owner_raw: String(raw['owner_name'] ?? '').trim() || null,
    };
  }
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  try { return new Date(raw).toISOString().split('T')[0]!; } catch { return null; }
}
