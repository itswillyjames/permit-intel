import type { Env } from "../index.js";
import { newId, nowIso } from "@permit-intel/shared/src/utils/index";

/**
 * Bootstraps the remote D1 database with a few demo permits.
 * - Auth is enforced in index.ts (x-api-key).
 * - Idempotent via INSERT OR IGNORE on UNIQUE(city, source_permit_id).
 *
 * This intentionally uses raw SQL directly against env.DB to avoid any
 * monorepo/workspace resolution issues during bundling.
 */
export async function handleSeedPermits(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  // Optional safety: disable seeding in prod by setting DISABLE_SEED=true as a Worker var/secret.
  const disableSeed = (env as any).DISABLE_SEED;
  if (String(disableSeed || "").toLowerCase() === "true") {
    return new Response(
      JSON.stringify({ error: "SEED_DISABLED", detail: "Seeding is disabled in this environment" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  // Minimal demo fixtures for immediate bootstrap.
  const fixtures = [
    {
      city: "Chicago",
      source_permit_id: "CHI-2024-001234",
      filed_date: "2024-01-15T00:00:00Z",
      issued_date: "2024-02-01T00:00:00Z",
      address_raw: "123 N Michigan Ave, Chicago, IL 60601",
      address_norm: "123 n michigan ave chicago il 60601",
      work_type: "New Construction",
      description_raw: "New 10-story mixed-use building, retail + residential",
      valuation: 25000000,
      applicant_raw: "ABC Development LLC",
      contractor_raw: "Reliable Builders Inc",
      owner_raw: "Chicago Property Holdings",
      status: "shortlisted",
      prequal_score: 0.85,
      prequal_reasons_json: JSON.stringify(["High valuation", "Mixed-use", "Commercial fit"]),
    },
    {
      city: "Seattle",
      source_permit_id: "SEA-2024-567890",
      filed_date: "2024-02-10T00:00:00Z",
      issued_date: null,
      address_raw: "456 Pine St, Seattle, WA 98101",
      address_norm: "456 pine st seattle wa 98101",
      work_type: "Tenant Improvement",
      description_raw: "Office build-out for tech company, 15,000 sqft",
      valuation: 1200000,
      applicant_raw: "TechCorp LLC",
      contractor_raw: "Northwest Interiors",
      owner_raw: "Seattle Commercial Realty",
      status: "prequalified",
      prequal_score: 0.72,
      prequal_reasons_json: JSON.stringify(["Commercial TI", "Mid-size valuation"]),
    },
    {
      city: "Denver",
      source_permit_id: "DEN-2024-111222",
      filed_date: "2024-01-20T00:00:00Z",
      issued_date: null,
      address_raw: "321 17th St, Denver, CO 80202",
      address_norm: "321 17th st denver co 80202",
      work_type: "Addition",
      description_raw: "Warehouse expansion, +20,000 sqft industrial",
      valuation: 3500000,
      applicant_raw: "Mountain Logistics LLC",
      contractor_raw: "Rocky Mountain Builders",
      owner_raw: "Denver Industrial Holdings",
      status: "shortlisted",
      prequal_score: 0.78,
      prequal_reasons_json: JSON.stringify(["Industrial expansion", "Large addition"]),
    },
    {
      city: "Austin",
      source_permit_id: "AUS-2024-333444",
      filed_date: "2024-02-25T00:00:00Z",
      issued_date: null,
      address_raw: "555 Congress Ave, Austin, TX 78701",
      address_norm: "555 congress ave austin tx 78701",
      work_type: "New Construction",
      description_raw: "Single-family residential, 3,500 sqft custom home",
      valuation: 950000,
      applicant_raw: "Austin Dream Homes",
      contractor_raw: "Texas Custom Builders",
      owner_raw: "Jane Doe",
      status: "rejected",
      prequal_score: 0.35,
      prequal_reasons_json: JSON.stringify(["Residential noise", "Low commercial fit"]),
    },
  ];

  const db = env.DB;
  const ts = nowIso();

  const insertSql = `
    INSERT OR IGNORE INTO permits (
      id,
      city,
      source_permit_id,
      filed_date,
      issued_date,
      address_raw,
      address_norm,
      work_type,
      description_raw,
      valuation,
      applicant_raw,
      contractor_raw,
      owner_raw,
      status,
      prequal_score,
      prequal_reasons_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const existsSql = `
    SELECT 1 FROM permits WHERE city = ? AND source_permit_id = ? LIMIT 1
  `;

  let existed = 0;
  let inserted = 0;

  for (const p of fixtures) {
    const already = await db.prepare(existsSql).bind(p.city, p.source_permit_id).first();
    if (already) {
      existed++;
      continue;
    }

    const id = newId();

    await db
      .prepare(insertSql)
      .bind(
        id,
        p.city,
        p.source_permit_id,
        p.filed_date,
        p.issued_date,
        p.address_raw,
        p.address_norm,
        p.work_type,
        p.description_raw,
        p.valuation,
        p.applicant_raw,
        p.contractor_raw,
        p.owner_raw,
        p.status,
        p.prequal_score,
        p.prequal_reasons_json,
        ts,
        ts,
      )
      .run();

    inserted++;
  }

  return new Response(
    JSON.stringify({
      message: "Seed complete",
      permits_inserted: inserted,
      permits_already_existed: existed,
      permits_total_fixtures: fixtures.length,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
