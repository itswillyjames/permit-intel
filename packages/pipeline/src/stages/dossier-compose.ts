import { BaseStageRunner } from './runner.js';
import { validateStageOutput, type DossierComposeOutput } from '@permit-intel/shared/src/schemas/stages.js';
import { ValidationError } from '@permit-intel/shared/src/errors.js';
import type { PermitParseOutput, EntityExtractOutput, ContactDiscoveryOutput } from '@permit-intel/shared/src/schemas/stages.js';

export interface DossierComposeInput {
  permit: {
    address_norm: string | null;
    city: string;
    work_type: string | null;
    valuation: number | null;
    filed_date: string | null;
    issued_date: string | null;
    description_raw: string | null;
  };
  parseOutput: PermitParseOutput;
  entityOutput: EntityExtractOutput;
  contactOutput: ContactDiscoveryOutput;
  evidenceIndex: Array<{ evidence_id: string; title: string; source: string; retrieved_at: string }>;
}

export class DossierComposeStage extends BaseStageRunner<DossierComposeInput, DossierComposeOutput> {
  readonly stageName = 'dossier_compose';
  readonly promptVersion = 'v1';

  protected buildPrompt(input: DossierComposeInput) {
    return [
      {
        role: 'system' as const,
        content: `You are a commercial real estate broker intelligence analyst. Compose a detailed, actionable broker dossier from permit and enrichment data. Be specific, concrete, and sales-oriented. Respond ONLY with valid JSON.`,
      },
      {
        role: 'user' as const,
        content: `Compose a broker dossier for this commercial permit.

PERMIT:
${JSON.stringify(input.permit, null, 2)}

PROJECT ANALYSIS:
${JSON.stringify(input.parseOutput, null, 2)}

KEY ENTITIES:
${JSON.stringify(input.entityOutput, null, 2)}

CONTACTS:
${JSON.stringify(input.contactOutput, null, 2)}

EVIDENCE:
${JSON.stringify(input.evidenceIndex, null, 2)}

Respond with ONLY this JSON structure (no markdown, strict schema):
{
  "dossier": {
    "headline": "one compelling sentence describing the opportunity",
    "summary": "3-5 paragraph executive summary for a broker",
    "project": {
      "address": "full address string",
      "city": "city name",
      "work_type": "work type string",
      "valuation": integer_or_null,
      "timeline": {"filed_date": "YYYY-MM-DD or null", "issued_date": "YYYY-MM-DD or null"}
    },
    "key_entities": [
      {"role": "string", "canonical_name": "string", "confidence": 0.0-1.0, "contacts": ["email or phone strings"]}
    ],
    "recommended_next_steps": ["actionable step 1", "step 2", ...],
    "evidence_index": [{"evidence_id": "uuid", "title": "string", "source": "string", "retrieved_at": "string"}]
  },
  "playbook": {
    "positioning": ["positioning angle 1", ...],
    "buyer_targets": ["target 1", ...],
    "pricing_logic": ["pricing rationale 1", ...],
    "objections_and_rebuttals": ["objection: rebuttal", ...]
  }
}`,
      },
    ];
  }

  protected parseAndValidate(raw: unknown): DossierComposeOutput {
    try {
      return validateStageOutput('dossier_compose', raw);
    } catch (e) {
      throw new ValidationError(`dossier_compose schema validation failed: ${e}`, 'schema', e);
    }
  }

  protected override semanticValidate(output: DossierComposeOutput): void {
    if (!output.dossier.headline.trim()) {
      throw new ValidationError('dossier headline must not be empty', 'semantic', null);
    }
    if (output.dossier.recommended_next_steps.length === 0) {
      throw new ValidationError('recommended_next_steps must have at least one item', 'semantic', null);
    }
  }
}
