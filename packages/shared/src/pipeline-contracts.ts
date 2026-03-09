// packages/shared/src/pipeline-contracts.ts
// Strict JSON contracts per pipeline stage with schema + semantic validation.

// ============================================================
// TYPE DEFINITIONS (match JSON contracts from spec)
// ============================================================

export interface PermitParseOutput {
  permit: {
    project_type:
      | "commercial"
      | "mixed_use"
      | "industrial"
      | "institutional"
      | "other";
    scope_summary: string;
    estimated_size_sqft: number;
    buyer_fit: {
      score: number; // 0.0 - 1.0
      reasons: string[];
    };
  };
}

export interface EntityIdentifier {
  type: "domain" | "license" | "state_reg" | "other";
  value: string;
}

export interface ExtractedEntity {
  role: "owner" | "contractor" | "architect" | "engineer" | "applicant";
  name_raw: string;
  name_norm: string;
  address_raw: string;
  address_norm: string;
  identifiers: EntityIdentifier[];
  confidence: number; // 0.0 - 1.0
  evidence: {
    evidence_ids: string[];
    quotes: string[];
  };
}

export interface EntityExtractOutput {
  entities: ExtractedEntity[];
}

export interface ContactDiscoveryOutput {
  contacts: Array<{
    entity_name_norm: string;
    person_name: string;
    role: string;
    email: string;
    phone: string;
    linkedin: string;
    confidence: number;
    evidence: { evidence_ids: string[] };
  }>;
}

export interface DossierComposeOutput {
  dossier: {
    headline: string;
    summary: string;
    project: {
      address: string;
      city: string;
      work_type: string;
      valuation: number;
      timeline: {
        filed_date: string;
        issued_date: string;
      };
    };
    key_entities: Array<{
      role: string;
      canonical_name: string;
      confidence: number;
      contacts: string[];
    }>;
    recommended_next_steps: string[];
    evidence_index: Array<{
      evidence_id: string;
      title: string;
      source: string;
      retrieved_at: string;
    }>;
  };
  playbook: {
    positioning: string[];
    buyer_targets: string[];
    pricing_logic: string[];
    objections_and_rebuttals: string[];
  };
}

export type StageOutput =
  | { stage: "permit_parse"; output: PermitParseOutput }
  | { stage: "entity_extract"; output: EntityExtractOutput }
  | { stage: "contact_discovery"; output: ContactDiscoveryOutput }
  | { stage: "dossier_compose"; output: DossierComposeOutput };

// ============================================================
// VALIDATION ERROR
// ============================================================

export class ValidationError extends Error {
  constructor(
    public readonly stage: string,
    public readonly kind: "syntactic" | "semantic",
    public readonly details: string[],
  ) {
    super(`[${stage}] ${kind} validation failed: ${details.join("; ")}`);
    this.name = "ValidationError";
  }
}

export class RetryableValidationError extends ValidationError {
  constructor(stage: string, details: string[]) {
    super(stage, "semantic", details);
    this.name = "RetryableValidationError";
  }
}

// ============================================================
// VALIDATORS
// ============================================================

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const errs: string[] = [];
  if (typeof obj[key] !== "string" || (obj[key] as string).trim() === "") {
    errs.push(`${path}.${key} must be a non-empty string`);
  }
  return errs;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  min = 0,
  max = 1,
): string[] {
  const errs: string[] = [];
  const v = obj[key];
  if (typeof v !== "number" || v < min || v > max) {
    errs.push(`${path}.${key} must be a number in [${min}, ${max}]`);
  }
  return errs;
}

export function validatePermitParseOutput(raw: unknown): PermitParseOutput {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("permit_parse", "syntactic", [
      "output must be an object",
    ]);
  }
  const r = raw as Record<string, unknown>;
  if (!r["permit"] || typeof r["permit"] !== "object") {
    errs.push("permit is required");
  } else {
    const p = r["permit"] as Record<string, unknown>;
    const validTypes = [
      "commercial",
      "mixed_use",
      "industrial",
      "institutional",
      "other",
    ];
    if (!validTypes.includes(p["project_type"] as string)) {
      errs.push(`permit.project_type must be one of: ${validTypes.join(", ")}`);
    }
    errs.push(...requireString(p, "scope_summary", "permit"));
    if (typeof p["estimated_size_sqft"] !== "number") {
      errs.push("permit.estimated_size_sqft must be a number");
    }
    if (p["buyer_fit"] && typeof p["buyer_fit"] === "object") {
      const bf = p["buyer_fit"] as Record<string, unknown>;
      errs.push(...requireNumber(bf, "score", "permit.buyer_fit"));
      if (!Array.isArray(bf["reasons"])) {
        errs.push("permit.buyer_fit.reasons must be an array");
      }
    } else {
      errs.push("permit.buyer_fit is required");
    }
  }
  if (errs.length > 0) {
    throw new RetryableValidationError("permit_parse", errs);
  }
  return raw as PermitParseOutput;
}

export function validateEntityExtractOutput(raw: unknown): EntityExtractOutput {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("entity_extract", "syntactic", [
      "output must be an object",
    ]);
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["entities"])) {
    throw new ValidationError("entity_extract", "syntactic", [
      "entities must be an array",
    ]);
  }
  const validRoles = ["owner", "contractor", "architect", "engineer", "applicant"];
  for (let i = 0; i < r["entities"].length; i++) {
    const e = r["entities"][i] as Record<string, unknown>;
    if (!validRoles.includes(e["role"] as string)) {
      errs.push(`entities[${i}].role invalid`);
    }
    errs.push(...requireString(e, "name_raw", `entities[${i}]`));
    errs.push(...requireString(e, "name_norm", `entities[${i}]`));
    errs.push(...requireNumber(e, "confidence", `entities[${i}]`));
    if (!e["evidence"] || !Array.isArray((e["evidence"] as Record<string, unknown>)["evidence_ids"])) {
      errs.push(`entities[${i}].evidence.evidence_ids must be an array`);
    }
  }
  if (errs.length > 0) {
    throw new RetryableValidationError("entity_extract", errs);
  }
  return raw as EntityExtractOutput;
}

export function validateContactDiscoveryOutput(
  raw: unknown,
): ContactDiscoveryOutput {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("contact_discovery", "syntactic", [
      "output must be an object",
    ]);
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["contacts"])) {
    throw new ValidationError("contact_discovery", "syntactic", [
      "contacts must be an array",
    ]);
  }
  const errs: string[] = [];
  for (let i = 0; i < r["contacts"].length; i++) {
    const c = r["contacts"][i] as Record<string, unknown>;
    errs.push(...requireNumber(c, "confidence", `contacts[${i}]`));
  }
  if (errs.length > 0) {
    throw new RetryableValidationError("contact_discovery", errs);
  }
  return raw as ContactDiscoveryOutput;
}

export function validateDossierComposeOutput(
  raw: unknown,
): DossierComposeOutput {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("dossier_compose", "syntactic", [
      "output must be an object",
    ]);
  }
  const r = raw as Record<string, unknown>;
  if (!r["dossier"] || typeof r["dossier"] !== "object") {
    errs.push("dossier is required");
  } else {
    const d = r["dossier"] as Record<string, unknown>;
    errs.push(...requireString(d, "headline", "dossier"));
    errs.push(...requireString(d, "summary", "dossier"));
    if (!d["project"]) errs.push("dossier.project is required");
    if (!Array.isArray(d["recommended_next_steps"])) {
      errs.push("dossier.recommended_next_steps must be an array");
    }
    if (!Array.isArray(d["evidence_index"])) {
      errs.push("dossier.evidence_index must be an array");
    }
  }
  if (!r["playbook"] || typeof r["playbook"] !== "object") {
    errs.push("playbook is required");
  } else {
    const p = r["playbook"] as Record<string, unknown>;
    for (const key of [
      "positioning",
      "buyer_targets",
      "pricing_logic",
      "objections_and_rebuttals",
    ]) {
      if (!Array.isArray(p[key])) {
        errs.push(`playbook.${key} must be an array`);
      }
    }
  }
  if (errs.length > 0) {
    throw new RetryableValidationError("dossier_compose", errs);
  }
  return raw as DossierComposeOutput;
}

/** Dispatch to the correct validator by stage name */
export function validateStageOutput(
  stageName: string,
  raw: unknown,
): PermitParseOutput | EntityExtractOutput | ContactDiscoveryOutput | DossierComposeOutput {
  switch (stageName) {
    case "permit_parse":
      return validatePermitParseOutput(raw);
    case "entity_extract":
      return validateEntityExtractOutput(raw);
    case "contact_discovery":
      return validateContactDiscoveryOutput(raw);
    case "dossier_compose":
      return validateDossierComposeOutput(raw);
    default:
      throw new ValidationError(stageName, "syntactic", [
        `Unknown stage: ${stageName}`,
      ]);
  }
}
