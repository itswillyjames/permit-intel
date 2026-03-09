import { BaseStageRunner } from './runner.js';
import { validateStageOutput, type EntityExtractOutput } from '@permit-intel/shared/src/schemas/stages.js';
import { ValidationError } from '@permit-intel/shared/src/errors.js';

export interface EntityExtractInput {
  permit: {
    city: string;
    address_norm: string | null;
    work_type: string | null;
    description_raw: string | null;
    applicant_raw: string | null;
    contractor_raw: string | null;
    owner_raw: string | null;
  };
  evidenceIds: string[];
}

export class EntityExtractStage extends BaseStageRunner<EntityExtractInput, EntityExtractOutput> {
  readonly stageName = 'entity_extract';
  readonly promptVersion = 'v1';

  protected buildPrompt(input: EntityExtractInput) {
    const { permit } = input;
    return [
      {
        role: 'system' as const,
        content: `You are an expert at extracting and normalizing entity information from building permit records. Extract all named persons and organizations. Normalize names consistently. Respond ONLY with valid JSON.`,
      },
      {
        role: 'user' as const,
        content: `Extract entities from this permit record.

Permit:
- City: ${permit.city}
- Address: ${permit.address_norm ?? 'unknown'}
- Work Type: ${permit.work_type ?? 'unknown'}
- Description: ${permit.description_raw ?? 'none'}
- Applicant: ${permit.applicant_raw ?? 'none'}
- Contractor: ${permit.contractor_raw ?? 'none'}
- Owner: ${permit.owner_raw ?? 'none'}

Available evidence IDs: ${JSON.stringify(input.evidenceIds)}

Respond with ONLY this JSON (no markdown):
{
  "entities": [
    {
      "role": "owner|contractor|architect|engineer|applicant",
      "name_raw": "exact name as appears in source",
      "name_norm": "normalized canonical name (Title Case, remove Inc/LLC variants)",
      "address_raw": "string or null",
      "address_norm": "lowercase normalized or null",
      "identifiers": [{"type": "domain|license|state_reg|other", "value": "string"}],
      "confidence": 0.0_to_1.0,
      "evidence": {"evidence_ids": [], "quotes": ["exact text from permit"]}
    }
  ]
}`,
      },
    ];
  }

  protected parseAndValidate(raw: unknown): EntityExtractOutput {
    try {
      return validateStageOutput('entity_extract', raw);
    } catch (e) {
      throw new ValidationError(`entity_extract schema validation failed: ${e}`, 'schema', e);
    }
  }

  protected override semanticValidate(output: EntityExtractOutput): void {
    for (const entity of output.entities) {
      if (!entity.name_norm.trim()) {
        throw new ValidationError('entity name_norm must not be empty', 'semantic', entity);
      }
      if (entity.confidence < 0.3) {
        // Low confidence entities should still be included but logged
        // not a hard failure
      }
    }
  }
}
