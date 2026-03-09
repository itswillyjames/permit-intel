import type { CityAdapter, RawPermitRow } from './adapter.js';
import type { UpsertPermitInput } from '@permit-intel/db/src/queries/permits.js';
import { normalizeAddress } from '@permit-intel/shared/src/utils/index.js';

/**
 * Seattle building permit adapter.
 * Source: Seattle Open Data (Socrata) — "Building Permits" dataset
 */
export class SeattleAdapter implements CityAdapter {
  readonly city = 'seattle';
  readonly sourceName = 'seattle_open_data';

  private readonly baseUrl = 'https://data.seattle.gov/resource/k44w-2dcq.json';

  async fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }> {
    const since = cursor ?? '2020-01-01T00:00:00.000';
    const url = `${this.baseUrl}?$where=issueddate>'${since}'&$order=issueddate ASC&$limit=500`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Seattle fetch failed: ${resp.status}`);
    const rows: RawPermitRow[] = await resp.json();
    const nextCursor = rows.length > 0
      ? String(rows[rows.length - 1]!['issueddate'] ?? since)
      : null;
    return { rows, nextCursor };
  }

  normalize(raw: RawPermitRow): UpsertPermitInput | null {
    const permitNumber = String(raw['permitnum'] ?? '').trim();
    if (!permitNumber) return null;
    const address = String(raw['originaladdress1'] ?? '').trim();
    const valuation = parseFloat(String(raw['estprojectcost'] ?? '0')) || null;

    return {
      city: this.city,
      source_permit_id: permitNumber,
      filed_date: normalizeDate(String(raw['applicationdate'] ?? '')),
      issued_date: normalizeDate(String(raw['issueddate'] ?? '')),
      address_raw: address || null,
      address_norm: address ? normalizeAddress(address) : null,
      work_type: String(raw['permittypemapped'] ?? raw['permittype'] ?? '').trim() || null,
      description_raw: String(raw['description'] ?? '').trim() || null,
      valuation: valuation ? Math.round(valuation) : null,
      applicant_raw: String(raw['applicantcompany'] ?? '').trim() || null,
      contractor_raw: String(raw['contractorcompanyname'] ?? '').trim() || null,
      owner_raw: String(raw['ownername'] ?? '').trim() || null,
    };
  }
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  try { return new Date(raw).toISOString().split('T')[0]!; } catch { return null; }
}
