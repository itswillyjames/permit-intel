import { z } from 'zod';

// ---------------------------------------------------------------------------
// permit_parse output schema
// ---------------------------------------------------------------------------
export const PermitParseOutputSchema = z.object({
  permit: z.object({
    project_type: z.enum(['commercial', 'mixed_use', 'industrial', 'institutional', 'other']),
    scope_summary: z.string().min(10).max(2000),
    estimated_size_sqft: z.number().int().nonnegative().nullable(),
    buyer_fit: z.object({
      score: z.number().min(0).max(1),
      reasons: z.array(z.string().max(200)).min(1).max(10),
    }),
  }),
}).strict();

export type PermitParseOutput = z.infer<typeof PermitParseOutputSchema>;

// ---------------------------------------------------------------------------
// entity_extract output schema
// ---------------------------------------------------------------------------
export const EntityExtractOutputSchema = z.object({
  entities: z.array(
    z.object({
      role: z.enum(['owner', 'contractor', 'architect', 'engineer', 'applicant']),
      name_raw: z.string().max(300),
      name_norm: z.string().max(300),
      address_raw: z.string().max(500).nullable(),
      address_norm: z.string().max(500).nullable(),
      identifiers: z.array(
        z.object({
          type: z.enum(['domain', 'license', 'state_reg', 'other']),
          value: z.string().max(200),
        }),
      ),
      confidence: z.number().min(0).max(1),
      evidence: z.object({
        evidence_ids: z.array(z.string().uuid()),
        quotes: z.array(z.string().max(500)),
      }),
    }),
  ),
}).strict();

export type EntityExtractOutput = z.infer<typeof EntityExtractOutputSchema>;

// ---------------------------------------------------------------------------
// contact_discovery output schema
// ---------------------------------------------------------------------------
export const ContactDiscoveryOutputSchema = z.object({
  contacts: z.array(
    z.object({
      entity_name_norm: z.string().max(300),
      person_name: z.string().max(200).nullable(),
      role: z.string().max(100),
      email: z.string().email().nullable().or(z.literal('')).or(z.null()),
      phone: z.string().max(30).nullable(),
      linkedin: z.string().url().nullable().or(z.literal('')).or(z.null()),
      confidence: z.number().min(0).max(1),
      evidence: z.object({
        evidence_ids: z.array(z.string().uuid()),
      }),
    }),
  ),
}).strict();

export type ContactDiscoveryOutput = z.infer<typeof ContactDiscoveryOutputSchema>;

// ---------------------------------------------------------------------------
// dossier_compose output schema
// ---------------------------------------------------------------------------
export const DossierComposeOutputSchema = z.object({
  dossier: z.object({
    headline: z.string().max(300),
    summary: z.string().max(5000),
    project: z.object({
      address: z.string().max(500),
      city: z.string().max(100),
      work_type: z.string().max(100),
      valuation: z.number().int().nonnegative().nullable(),
      timeline: z.object({
        filed_date: z.string().nullable(),
        issued_date: z.string().nullable(),
      }),
    }),
    key_entities: z.array(
      z.object({
        role: z.string().max(100),
        canonical_name: z.string().max(300),
        confidence: z.number().min(0).max(1),
        contacts: z.array(z.string().max(200)),
      }),
    ),
    recommended_next_steps: z.array(z.string().max(500)).max(10),
    evidence_index: z.array(
      z.object({
        evidence_id: z.string().uuid(),
        title: z.string().max(300),
        source: z.string().max(500),
        retrieved_at: z.string(),
      }),
    ),
  }),
  playbook: z.object({
    positioning: z.array(z.string().max(500)).max(10),
    buyer_targets: z.array(z.string().max(200)).max(10),
    pricing_logic: z.array(z.string().max(500)).max(10),
    objections_and_rebuttals: z.array(z.string().max(500)).max(10),
  }),
}).strict();

export type DossierComposeOutput = z.infer<typeof DossierComposeOutputSchema>;

// ---------------------------------------------------------------------------
// Stage output union type
// ---------------------------------------------------------------------------
export type StageOutputMap = {
  permit_parse: PermitParseOutput;
  entity_extract: EntityExtractOutput;
  contact_discovery: ContactDiscoveryOutput;
  dossier_compose: DossierComposeOutput;
};

export type StageName = keyof StageOutputMap;

export const STAGE_SCHEMAS: Record<StageName, z.ZodType> = {
  permit_parse: PermitParseOutputSchema,
  entity_extract: EntityExtractOutputSchema,
  contact_discovery: ContactDiscoveryOutputSchema,
  dossier_compose: DossierComposeOutputSchema,
};

/** Validate stage output against its schema. Returns parsed value or throws ZodError. */
export function validateStageOutput<S extends StageName>(
  stage: S,
  raw: unknown,
): StageOutputMap[S] {
  return STAGE_SCHEMAS[stage].parse(raw) as StageOutputMap[S];
}
