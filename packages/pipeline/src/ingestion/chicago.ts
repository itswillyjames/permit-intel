import type { CityAdapter, RawPermitRow } from './adapter.js';
import type { UpsertPermitInput } from '@permit-intel/db/src/queries/permits.js';
import { normalizeAddress } from '@permit-intel/shared/src/utils/index.js';

/**
 * Chicago building permit adapter.
 * Source: Chicago Data Portal (Socrata) — "Building Permits" dataset
 * API: https://data.cityofchicago.org/resource/ydr8-5enu.json
 */
export class ChicagoAdapter implements CityAdapter {
  readonly city = 'chicago';
  readonly sourceName = 'chicago_data_portal';

  private readonly baseUrl = 'https://data.cityofchicago.org/resource/ydr8-5enu.json';

  async fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }> {
    const since = cursor ?? '2020-01-01T00:00:00.000';
    const url = `${this.baseUrl}?$where=issue_date>'${since}'&$order=issue_date ASC&$limit=500`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Chicago fetch failed: ${resp.status}`);
    const rows: RawPermitRow[] = await resp.json();
    const nextCursor = rows.length > 0
      ? String(rows[rows.length - 1]!['issue_date'] ?? since)
      : null;
    return { rows, nextCursor };
  }

  normalize(raw: RawPermitRow): UpsertPermitInput | null {
    const permitNumber = String(raw['permit_'] ?? raw['permit_no'] ?? '').trim();
    if (!permitNumber) return null;

    // Skip residential unless large valuation
    const workType = String(raw['permit_type'] ?? '').trim();
    const address = [
      raw['street_number'],
      raw['street_direction'],
      raw['street_name'],
      raw['suffix'],
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const valuation = parseFloat(String(raw['reported_cost'] ?? '0')) || null;

    return {
      city: this.city,
      source_permit_id: permitNumber,
      filed_date: normalizeDate(String(raw['application_start_date'] ?? '')),
      issued_date: normalizeDate(String(raw['issue_date'] ?? '')),
      address_raw: address || null,
      address_norm: address ? normalizeAddress(address) : null,
      work_type: workType || null,
      description_raw: String(raw['work_description'] ?? '').trim() || null,
      valuation: valuation ? Math.round(valuation) : null,
      applicant_raw: String(raw['contact_1_name'] ?? '').trim() || null,
      contractor_raw: String(raw['contact_1_name'] ?? '').trim() || null,
      owner_raw: String(raw['pin_'] ?? '').trim() || null,
    };
  }
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  try {
    return new Date(raw).toISOString().split('T')[0]!;
  } catch {
    return null;
  }
}
