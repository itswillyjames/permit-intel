// packages/pipeline/src/prequal.ts
// Deterministic prequalification rules engine.
// "Cheap-first": no AI calls, purely deterministic scoring.
// Runs before any expensive enrichment.

import type { PermitRow } from "@permit-intel/db";

export interface PrequalConfig {
  minValuation: number; // default 500_000
  requiredWorkTypes: string[]; // if non-empty, permit must match one
  blockedWorkTypes: string[]; // auto-reject if matches
  requireAddress: boolean; // reject if no address_norm
  scoreWeights: {
    valuation: number; // weight out of 100
    workType: number;
    completeness: number;
  };
  shortlistThreshold: number; // 0-100
}

export const DEFAULT_PREQUAL_CONFIG: PrequalConfig = {
  minValuation: 500_000,
  requiredWorkTypes: [],
  blockedWorkTypes: [
    "residential",
    "single_family",
    "demolition",
    "fence",
    "sign",
    "electrical_only",
    "plumbing_only",
    "mechanical_only",
  ],
  requireAddress: true,
  scoreWeights: {
    valuation: 50,
    workType: 30,
    completeness: 20,
  },
  shortlistThreshold: 60,
};

export interface PrequalResult {
  score: number; // 0-100
  reasons: string[];
  decision: "shortlisted" | "prequalified" | "rejected";
}

// High-value commercial work types
const HIGH_VALUE_WORK_TYPES = new Set([
  "commercial",
  "mixed_use",
  "industrial",
  "institutional",
  "office",
  "retail",
  "hotel",
  "warehouse",
  "manufacturing",
  "data_center",
  "medical",
  "multifamily",
  "new_construction",
]);

export function scorePermit(
  permit: PermitRow,
  config: PrequalConfig = DEFAULT_PREQUAL_CONFIG,
): PrequalResult {
  const reasons: string[] = [];
  let score = 0;

  // ---- Hard rejection checks ----
  if (config.requireAddress && !permit.address_norm?.trim()) {
    return {
      score: 0,
      reasons: ["reject:no_address"],
      decision: "rejected",
    };
  }

  const workTypeLower = (permit.work_type ?? "").toLowerCase().replace(/\s+/g, "_");

  if (config.blockedWorkTypes.some((b) => workTypeLower.includes(b))) {
    return {
      score: 0,
      reasons: [`reject:blocked_work_type:${workTypeLower}`],
      decision: "rejected",
    };
  }

  if (
    config.minValuation > 0 &&
    (permit.valuation === null || permit.valuation < config.minValuation)
  ) {
    reasons.push(
      `reject:valuation_too_low:${permit.valuation ?? 0}<${config.minValuation}`,
    );
    return { score: 0, reasons, decision: "rejected" };
  }

  // ---- Valuation score (up to scoreWeights.valuation) ----
  const val = permit.valuation ?? 0;
  const valScore = Math.min(
    config.scoreWeights.valuation,
    Math.round(
      config.scoreWeights.valuation *
        clamp((val - config.minValuation) / (10_000_000 - config.minValuation), 0, 1),
    ),
  );
  score += valScore;
  reasons.push(`valuation_score:${valScore}/${config.scoreWeights.valuation}`);

  // ---- Work type score ----
  let wtScore = 0;
  if (HIGH_VALUE_WORK_TYPES.has(workTypeLower)) {
    wtScore = config.scoreWeights.workType;
    reasons.push(`work_type:${workTypeLower}:high_value`);
  } else if (config.requiredWorkTypes.length > 0) {
    if (config.requiredWorkTypes.some((r) => workTypeLower.includes(r))) {
      wtScore = config.scoreWeights.workType;
      reasons.push(`work_type:${workTypeLower}:required_match`);
    } else {
      reasons.push(`work_type:${workTypeLower}:no_match`);
    }
  } else {
    // Partial credit for non-blocked, non-empty type
    wtScore = workTypeLower ? Math.floor(config.scoreWeights.workType / 2) : 0;
    reasons.push(`work_type:${workTypeLower}:partial`);
  }
  score += wtScore;

  // ---- Completeness score ----
  let completeness = 0;
  const fields = [
    permit.address_norm,
    permit.work_type,
    permit.description_raw,
    permit.applicant_raw ?? permit.contractor_raw,
    permit.filed_date,
    permit.valuation !== null ? String(permit.valuation) : null,
  ];
  for (const f of fields) {
    if (f && String(f).trim()) completeness++;
  }
  const completenessScore = Math.round(
    (completeness / fields.length) * config.scoreWeights.completeness,
  );
  score += completenessScore;
  reasons.push(
    `completeness:${completeness}/${fields.length}:score:${completenessScore}`,
  );

  // ---- Decision ----
  let decision: PrequalResult["decision"];
  if (score >= config.shortlistThreshold) {
    decision = "shortlisted";
  } else {
    decision = "prequalified";
  }

  return { score, reasons, decision };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
