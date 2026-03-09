import { BaseStageRunner } from './runner.js';
import { validateStageOutput, type PermitParseOutput } from '@permit-intel/shared/src/schemas/stages.js';
import { ValidationError } from '@permit-intel/shared/src/errors.js';

export interface PermitParseInput {
  city: string;
  work_type: string | null;
  description_raw: string | null;
  address_norm: string | null;
  valuation: number | null;
}

export class PermitParseStage extends BaseStageRunner<PermitParseInput, PermitParseOutput> {
  readonly stageName = 'permit_parse';
  readonly promptVersion = 'v1';

  protected buildPrompt(input: PermitParseInput) {
    return [
      {
        role: 'system' as const,
        content: `You are a commercial real estate intelligence assistant. Analyze municipal building permit data and respond ONLY with valid JSON matching the exact schema provided. No extra keys.`,
      },
      {
        role: 'user' as const,
        content: `Analyze this building permit and classify it.

Permit data:
- City: ${input.city}
- Work Type: ${input.work_type ?? 'unknown'}
- Address: ${input.address_norm ?? 'unknown'}
- Valuation: ${input.valuation ? `$${input.valuation.toLocaleString()}` : 'unknown'}
- Description: ${input.description_raw ?? 'none'}

Respond with ONLY this JSON structure (no markdown, no extra keys):
{
  "permit": {
    "project_type": "commercial|mixed_use|industrial|institutional|other",
    "scope_summary": "2-4 sentence summary of the project scope",
    "estimated_size_sqft": null_or_integer,
    "buyer_fit": {
      "score": 0.0_to_1.0,
      "reasons": ["reason1", "reason2"]
    }
  }
}`,
      },
    ];
  }

  protected parseAndValidate(raw: unknown): PermitParseOutput {
    try {
      return validateStageOutput('permit_parse', raw);
    } catch (e) {
      throw new ValidationError(`permit_parse schema validation failed: ${e}`, 'schema', e);
    }
  }

  protected override semanticValidate(output: PermitParseOutput): void {
    if (output.permit.buyer_fit.score < 0 || output.permit.buyer_fit.score > 1) {
      throw new ValidationError('buyer_fit.score out of range [0,1]', 'semantic', output.permit.buyer_fit.score);
    }
    if (output.permit.buyer_fit.reasons.length === 0) {
      throw new ValidationError('buyer_fit.reasons must not be empty', 'semantic', null);
    }
  }
}
