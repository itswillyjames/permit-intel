// packages/pipeline/src/__tests__/prequal.test.ts
import { describe, it, expect } from "vitest";
import { scorePermit, DEFAULT_PREQUAL_CONFIG } from "../prequal.js";
import type { PermitRow } from "@permit-intel/db";

function makePermit(overrides: Partial<PermitRow>): PermitRow {
  return {
    id: "test-id",
    city: "chicago",
    source_permit_id: "TEST-001",
    filed_date: "2024-01-01",
    issued_date: null,
    address_raw: "123 Main St Chicago IL 60601",
    address_norm: "123 main st chicago il 60601",
    work_type: "commercial",
    description_raw: "Office renovation",
    valuation: 1000000,
    applicant_raw: "Test LLC",
    contractor_raw: "Builder Inc",
    owner_raw: "Owner Corp",
    status: "new",
    prequal_score: 0,
    prequal_reasons_json: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("prequal scoring", () => {
  it("rejects permits below minimum valuation", () => {
    const result = scorePermit(makePermit({ valuation: 100000 }));
    expect(result.decision).toBe("rejected");
    expect(result.score).toBe(0);
    expect(result.reasons.some((r) => r.includes("valuation_too_low"))).toBe(true);
  });

  it("rejects permits with no address", () => {
    const result = scorePermit(makePermit({ address_norm: "" }));
    expect(result.decision).toBe("rejected");
    expect(result.reasons.some((r) => r.includes("no_address"))).toBe(true);
  });

  it("rejects blocked work types", () => {
    const result = scorePermit(makePermit({ work_type: "residential" }));
    expect(result.decision).toBe("rejected");
    expect(result.reasons.some((r) => r.includes("blocked_work_type"))).toBe(true);
  });

  it("rejects fence work type", () => {
    const result = scorePermit(makePermit({ work_type: "fence", valuation: 10000 }));
    expect(result.decision).toBe("rejected");
  });

  it("shortlists high-value commercial permits", () => {
    const result = scorePermit(
      makePermit({ work_type: "commercial", valuation: 2800000 }),
    );
    expect(result.decision).toBe("shortlisted");
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("shortlists mixed_use high valuation", () => {
    const result = scorePermit(
      makePermit({ work_type: "mixed_use", valuation: 42000000 }),
    );
    expect(result.decision).toBe("shortlisted");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("gives partial score for unknown work types above threshold", () => {
    const result = scorePermit(
      makePermit({ work_type: "unknown_type", valuation: 1500000 }),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("partial"))).toBe(true);
  });

  it("completeness score reflects field presence", () => {
    const full = scorePermit(makePermit({
      valuation: 1000000,
      work_type: "commercial",
      description_raw: "Full description",
      applicant_raw: "Test LLC",
      filed_date: "2024-01-01",
    }));
    const sparse = scorePermit(makePermit({
      valuation: 1000000,
      work_type: "commercial",
      description_raw: null,
      applicant_raw: null,
      contractor_raw: null,
      filed_date: null,
    }));
    expect(full.score).toBeGreaterThan(sparse.score);
  });

  it("scores match golden fixtures", () => {
    const fixtures = [
      {
        permit: makePermit({ work_type: "commercial", valuation: 2800000, description_raw: "Office renovation" }),
        expectedMin: 70,
        expectedDecision: "shortlisted" as const,
      },
      {
        permit: makePermit({ work_type: "residential", valuation: 45000 }),
        expectedMin: 0,
        expectedDecision: "rejected" as const,
      },
      {
        permit: makePermit({ work_type: "data_center", valuation: 125000000 }),
        expectedMin: 85,
        expectedDecision: "shortlisted" as const,
      },
      {
        permit: makePermit({ work_type: "sign", valuation: 5000 }),
        expectedMin: 0,
        expectedDecision: "rejected" as const,
      },
      {
        permit: makePermit({ address_norm: "", work_type: "commercial", valuation: 600000 }),
        expectedMin: 0,
        expectedDecision: "rejected" as const,
      },
    ];

    for (const f of fixtures) {
      const result = scorePermit(f.permit);
      expect(result.decision).toBe(f.expectedDecision);
      expect(result.score).toBeGreaterThanOrEqual(f.expectedMin);
    }
  });
});
