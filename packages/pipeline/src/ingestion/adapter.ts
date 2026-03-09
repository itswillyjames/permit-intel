import type { UpsertPermitInput } from '@permit-intel/db/src/queries/permits.js';
import { normalizeAddress, normalizeName } from '@permit-intel/shared/src/utils/index.js';

/** Raw permit row from a city data source */
export interface RawPermitRow {
  [key: string]: unknown;
}

/** City adapter interface — one per data source */
export interface CityAdapter {
  readonly city: string;
  readonly sourceName: string;

  /** Fetch rows since a cursor (ISO date string or row ID) */
  fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }>;

  /** Normalize raw row into canonical permit input */
  normalize(raw: RawPermitRow): UpsertPermitInput | null;
}

/** Common normalization helpers used by adapters */
export function normalizePermitFields(fields: {
  address?: string | null;
  applicant?: string | null;
  contractor?: string | null;
  owner?: string | null;
}): Partial<UpsertPermitInput> {
  return {
    address_norm: fields.address ? normalizeAddress(fields.address) : null,
    applicant_raw: fields.applicant ?? null,
    contractor_raw: fields.contractor ?? null,
    owner_raw: fields.owner ?? null,
  };
}
