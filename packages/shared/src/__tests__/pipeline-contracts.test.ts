// packages/shared/src/__tests__/pipeline-contracts.test.ts
import { describe, it, expect } from "vitest";
import {
  validatePermitParseOutput,
  validateEntityExtractOutput,
  validateContactDiscoveryOutput,
  validateDossierComposeOutput,
  validateStageOutput,
  ValidationError,
  RetryableValidationError,
} from "../pipeline-contracts.js";

describe("permit_parse contract", () => {
  const valid = {
    permit: {
      project_type: "commercial",
      scope_summary: "12,000 sqft office TI on floors 8-10",
      estimated_size_sqft: 12000,
      buyer_fit: { score: 0.85, reasons: ["high valuation", "commercial type"] },
    },
  };

  it("accepts valid output", () => {
    expect(() => validatePermitParseOutput(valid)).not.toThrow();
    const out = validatePermitParseOutput(valid);
    expect(out.permit.project_type).toBe("commercial");
    expect(out.permit.buyer_fit.score).toBe(0.85);
  });

  it("rejects missing permit", () => {
    expect(() => validatePermitParseOutput({})).toThrow(RetryableValidationError);
  });

  it("rejects invalid project_type", () => {
    const bad = { permit: { ...valid.permit, project_type: "residential" } };
    expect(() => validatePermitParseOutput(bad)).toThrow(RetryableValidationError);
  });

  it("rejects score out of range", () => {
    const bad = {
      permit: { ...valid.permit, buyer_fit: { score: 1.5, reasons: [] } },
    };
    expect(() => validatePermitParseOutput(bad)).toThrow(RetryableValidationError);
  });

  it("rejects non-object", () => {
    expect(() => validatePermitParseOutput("string")).toThrow(ValidationError);
  });
});

describe("entity_extract contract", () => {
  const valid = {
    entities: [
      {
        role: "contractor",
        name_raw: "Turner Construction Co",
        name_norm: "turner construction co",
        address_raw: "375 Hudson St New York NY",
        address_norm: "375 hudson st new york ny",
        identifiers: [{ type: "license", value: "LIC-123" }],
        confidence: 0.9,
        evidence: { evidence_ids: ["ev-001"], quotes: ["Turner Construction"] },
      },
    ],
  };

  it("accepts valid output", () => {
    const out = validateEntityExtractOutput(valid);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.role).toBe("contractor");
  });

  it("accepts empty entities array", () => {
    const out = validateEntityExtractOutput({ entities: [] });
    expect(out.entities).toHaveLength(0);
  });

  it("rejects invalid role", () => {
    const bad = {
      entities: [{ ...valid.entities[0], role: "developer" }],
    };
    expect(() => validateEntityExtractOutput(bad)).toThrow(RetryableValidationError);
  });

  it("rejects missing evidence_ids", () => {
    const bad = {
      entities: [{ ...valid.entities[0], evidence: { quotes: [] } }],
    };
    expect(() => validateEntityExtractOutput(bad)).toThrow(RetryableValidationError);
  });

  it("rejects confidence > 1", () => {
    const bad = { entities: [{ ...valid.entities[0], confidence: 1.5 }] };
    expect(() => validateEntityExtractOutput(bad)).toThrow(RetryableValidationError);
  });
});

describe("contact_discovery contract", () => {
  const valid = {
    contacts: [
      {
        entity_name_norm: "turner construction co",
        person_name: "John Smith",
        role: "Project Executive",
        email: "jsmith@turner.com",
        phone: "212-555-0100",
        linkedin: "https://linkedin.com/in/jsmith",
        confidence: 0.8,
        evidence: { evidence_ids: ["ev-002"] },
      },
    ],
  };

  it("accepts valid output", () => {
    const out = validateContactDiscoveryOutput(valid);
    expect(out.contacts).toHaveLength(1);
  });

  it("accepts empty contacts", () => {
    expect(() => validateContactDiscoveryOutput({ contacts: [] })).not.toThrow();
  });

  it("rejects missing contacts array", () => {
    expect(() => validateContactDiscoveryOutput({})).toThrow(ValidationError);
  });
});

describe("dossier_compose contract", () => {
  const valid = {
    dossier: {
      headline: "Major Tech Office Expansion at 123 N Michigan Ave",
      summary: "A 12,000 sqft office TI for a tech company.",
      project: {
        address: "123 N Michigan Ave",
        city: "Chicago",
        work_type: "commercial",
        valuation: 2800000,
        timeline: { filed_date: "2024-01-15", issued_date: "2024-02-20" },
      },
      key_entities: [
        { role: "contractor", canonical_name: "Turner Construction Co", confidence: 0.9, contacts: [] },
      ],
      recommended_next_steps: ["Contact GC immediately"],
      evidence_index: [{ evidence_id: "ev-001", title: "Permit Record", source: "chicago_portal", retrieved_at: "2024-01-15T00:00:00Z" }],
    },
    playbook: {
      positioning: ["Early mover advantage"],
      buyer_targets: ["Tech companies seeking new office space"],
      pricing_logic: ["Market rate $45/sqft NNN"],
      objections_and_rebuttals: ["Too early: Engage now to lock in terms"],
    },
  };

  it("accepts valid dossier", () => {
    const out = validateDossierComposeOutput(valid);
    expect(out.dossier.headline).toBeTruthy();
    expect(out.playbook.positioning).toHaveLength(1);
  });

  it("rejects missing dossier", () => {
    expect(() => validateDossierComposeOutput({ playbook: valid.playbook })).toThrow(RetryableValidationError);
  });

  it("rejects missing playbook", () => {
    expect(() => validateDossierComposeOutput({ dossier: valid.dossier })).toThrow(RetryableValidationError);
  });

  it("rejects non-array playbook field", () => {
    const bad = { ...valid, playbook: { ...valid.playbook, positioning: "string" } };
    expect(() => validateDossierComposeOutput(bad)).toThrow(RetryableValidationError);
  });
});

describe("validateStageOutput dispatch", () => {
  it("routes to correct validator", () => {
    const permitParse = {
      permit: {
        project_type: "commercial",
        scope_summary: "test",
        estimated_size_sqft: 1000,
        buyer_fit: { score: 0.5, reasons: [] },
      },
    };
    expect(() => validateStageOutput("permit_parse", permitParse)).not.toThrow();
  });

  it("throws for unknown stage", () => {
    expect(() => validateStageOutput("unknown_stage", {})).toThrow(ValidationError);
  });
});
