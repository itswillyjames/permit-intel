// packages/pipeline/src/ingestion/adapters.ts
// City-specific permit ingest adapters.

import { normalizeAddress, normalizeName, now } from "@permit-intel/shared";
import type { PermitInsert } from "@permit-intel/db";

export interface RawPermitRow {
  [key: string]: unknown;
}

export interface IngestAdapter {
  readonly cityName: string;
  normalize(raw: RawPermitRow): PermitInsert;
  fetchSince?(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }>;
}

// ============================================================
// Chicago — Data Portal (Socrata)
// ============================================================

export class ChicagoAdapter implements IngestAdapter {
  readonly cityName = "chicago";

  normalize(raw: RawPermitRow): PermitInsert {
    return {
      city: "chicago",
      source_permit_id: String(raw["id"] ?? raw["permit_"] ?? raw["permit_number"] ?? ""),
      filed_date: normalizeDate(raw["application_start_date"] as string),
      issued_date: normalizeDate(raw["issue_date"] as string),
      address_raw: String(raw["street_number"] ?? "") + " " + String(raw["street_name"] ?? "") + " " + String(raw["street_direction"] ?? "") + " " + String(raw["suffix"] ?? ""),
      address_norm: normalizeAddress(
        [raw["street_number"], raw["street_direction"], raw["street_name"], raw["suffix"]]
          .filter(Boolean)
          .join(" "),
      ),
      work_type: normalizeWorkType(String(raw["permit_type"] ?? raw["work_description"] ?? "")),
      description_raw: String(raw["work_description"] ?? ""),
      valuation: parseValuation(raw["reported_cost"] as string | number),
      applicant_raw: String(raw["contact_1_name"] ?? ""),
      contractor_raw: String(raw["contact_1_name"] ?? ""),
      owner_raw: String(raw["contact_1_name"] ?? ""),
    };
  }

  async fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }> {
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const limit = 1000;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const url = `https://data.cityofchicago.org/resource/ydr8-5enu.json?$limit=${limit}&$offset=${offset}&$where=application_start_date>='${since}'&$order=application_start_date DESC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chicago API error: ${res.status}`);
    const rows = await res.json() as RawPermitRow[];
    return {
      rows,
      nextCursor: rows.length === limit ? String(offset + limit) : null,
    };
  }
}

// ============================================================
// Seattle — Open Data Portal
// ============================================================

export class SeattleAdapter implements IngestAdapter {
  readonly cityName = "seattle";

  normalize(raw: RawPermitRow): PermitInsert {
    return {
      city: "seattle",
      source_permit_id: String(raw["permitnum"] ?? raw["application_permit_number"] ?? ""),
      filed_date: normalizeDate(raw["applicationdate"] as string),
      issued_date: normalizeDate(raw["issueddate"] as string),
      address_raw: String(raw["originaladdress1"] ?? ""),
      address_norm: normalizeAddress(String(raw["originaladdress1"] ?? "")),
      work_type: normalizeWorkType(String(raw["permitclassmapped"] ?? raw["permitclass"] ?? "")),
      description_raw: String(raw["description"] ?? ""),
      valuation: parseValuation(raw["estprojectcost"] as string | number),
      applicant_raw: String(raw["applicantname"] ?? ""),
      contractor_raw: String(raw["contractorcompanyname"] ?? ""),
      owner_raw: String(raw["ownername"] ?? ""),
    };
  }

  async fetchSince(cursor: string | null): Promise<{ rows: RawPermitRow[]; nextCursor: string | null }> {
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const limit = 1000;
    const url = `https://data.seattle.gov/resource/ht3q-kdvx.json?$limit=${limit}&$offset=${offset}&$order=applicationdate DESC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Seattle API error: ${res.status}`);
    const rows = await res.json() as RawPermitRow[];
    return { rows, nextCursor: rows.length === limit ? String(offset + limit) : null };
  }
}

// ============================================================
// Denver
// ============================================================

export class DenverAdapter implements IngestAdapter {
  readonly cityName = "denver";

  normalize(raw: RawPermitRow): PermitInsert {
    return {
      city: "denver",
      source_permit_id: String(raw["permitno"] ?? raw["permit_number"] ?? ""),
      filed_date: normalizeDate(raw["applied_date"] as string),
      issued_date: normalizeDate(raw["issued_date"] as string),
      address_raw: String(raw["address"] ?? ""),
      address_norm: normalizeAddress(String(raw["address"] ?? "")),
      work_type: normalizeWorkType(String(raw["worktype"] ?? raw["work_type"] ?? "")),
      description_raw: String(raw["description"] ?? ""),
      valuation: parseValuation(raw["job_valuation"] as string | number),
      applicant_raw: String(raw["applicant"] ?? ""),
      contractor_raw: String(raw["contractor"] ?? ""),
      owner_raw: String(raw["owner"] ?? ""),
    };
  }
}

// ============================================================
// Cincinnati
// ============================================================

export class CincinnatiAdapter implements IngestAdapter {
  readonly cityName = "cincinnati";

  normalize(raw: RawPermitRow): PermitInsert {
    return {
      city: "cincinnati",
      source_permit_id: String(raw["permit_number"] ?? raw["id"] ?? ""),
      filed_date: normalizeDate(raw["application_date"] as string ?? raw["date_filed"] as string),
      issued_date: normalizeDate(raw["issue_date"] as string),
      address_raw: String(raw["address"] ?? raw["location_1_address"] ?? ""),
      address_norm: normalizeAddress(String(raw["address"] ?? "")),
      work_type: normalizeWorkType(String(raw["permit_type"] ?? raw["type_of_work"] ?? "")),
      description_raw: String(raw["description"] ?? ""),
      valuation: parseValuation(raw["estimated_cost"] as string | number),
      applicant_raw: String(raw["applicant_name"] ?? ""),
      contractor_raw: String(raw["contractor_name"] ?? ""),
      owner_raw: String(raw["owner_name"] ?? ""),
    };
  }
}

// ============================================================
// Austin
// ============================================================

export class AustinAdapter implements IngestAdapter {
  readonly cityName = "austin";

  normalize(raw: RawPermitRow): PermitInsert {
    return {
      city: "austin",
      source_permit_id: String(raw["permit_num"] ?? raw["permitnum"] ?? ""),
      filed_date: normalizeDate(raw["applied_date"] as string),
      issued_date: normalizeDate(raw["issue_date"] as string),
      address_raw: String(raw["original_address_1"] ?? raw["address"] ?? ""),
      address_norm: normalizeAddress(String(raw["original_address_1"] ?? raw["address"] ?? "")),
      work_type: normalizeWorkType(String(raw["permit_class_mapped"] ?? raw["work_type"] ?? "")),
      description_raw: String(raw["description"] ?? ""),
      valuation: parseValuation(raw["total_job_valuation"] as string | number ?? raw["valuation"] as string | number),
      applicant_raw: String(raw["applicant"] ?? ""),
      contractor_raw: String(raw["contractor"] ?? ""),
      owner_raw: String(raw["owner"] ?? ""),
    };
  }
}

// ============================================================
// Adapter registry
// ============================================================

export const ADAPTERS: Record<string, IngestAdapter> = {
  chicago: new ChicagoAdapter(),
  seattle: new SeattleAdapter(),
  denver: new DenverAdapter(),
  cincinnati: new CincinnatiAdapter(),
  austin: new AustinAdapter(),
};

// ============================================================
// Helper functions
// ============================================================

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0]!;
  } catch {
    return null;
  }
}

function parseValuation(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

function normalizeWorkType(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}
