/**
 * Deterministic prequalification engine.
 * Runs before any AI calls. Pure functions — no side effects.
 */

export interface PrequalConfig {
  minValuation: number;
  excludeWorkTypes: string[];
  boostWorkTypes: string[];
  cityWeights: Record<string, number>;
  thresholds: { shortlist: number; reject: number };
}

export const DEFAULT_PREQUAL_CONFIG: PrequalConfig = {
  minValuation: 100_000,
  excludeWorkTypes: ['electric', 'plumbing', 'sign', 'demolition', 'fence', 'sidewalk', 'curb'],
  boostWorkTypes: ['commercial', 'mixed use', 'industrial', 'new construction', 'addition', 'renovation'],
  cityWeights: { chicago: 1.0, seattle: 1.1, denver: 1.0, cincinnati: 0.9, austin: 1.05 },
  thresholds: { shortlist: 0.65, reject: 0.2 },
};

export interface PrequalResult {
  score: number;
  reasons: string[];
  status: 'shortlisted' | 'prequalified' | 'rejected';
}

export interface PrequalInput {
  city: string;
  work_type: string | null;
  valuation: number | null;
  description_raw: string | null;
  address_norm: string | null;
}

export function runPrequal(
  input: PrequalInput,
  config: PrequalConfig = DEFAULT_PREQUAL_CONFIG,
): PrequalResult {
  const reasons: string[] = [];
  let score = 0.5;

  // 1. Valuation
  if (!input.valuation || input.valuation < config.minValuation) {
    reasons.push(`Valuation $${(input.valuation ?? 0).toLocaleString()} below threshold`);
    score -= 0.3;
  } else {
    const boost = Math.min(input.valuation / 5_000_000, 1) * 0.25;
    score += boost;
    reasons.push(`Valuation $${input.valuation.toLocaleString()}`);
  }

  // 2. Work type
  const workLower = (input.work_type ?? '').toLowerCase();
  if (config.excludeWorkTypes.some((t) => workLower.includes(t))) {
    reasons.push(`Work type '${input.work_type}' excluded`);
    score -= 0.4;
  }
  if (config.boostWorkTypes.some((t) => workLower.includes(t))) {
    score += 0.15;
    reasons.push(`Work type '${input.work_type}' is high-value`);
  }

  // 3. Description
  const desc = (input.description_raw ?? '').toLowerCase();
  if (desc.length > 50) { score += 0.05; reasons.push('Description present'); }
  else { reasons.push('Thin description'); }

  // 4. Commercial keywords
  const keywords = ['office', 'retail', 'warehouse', 'hotel', 'restaurant', 'mixed use', 'industrial', 'medical'];
  const hits = keywords.filter((k) => desc.includes(k)).length;
  if (hits > 0) {
    score += hits * 0.04;
    reasons.push(`Commercial keywords: ${hits}`);
  }

  // 5. City weight
  score *= config.cityWeights[input.city] ?? 1.0;

  // Clamp to [0,1]
  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));

  const status: PrequalResult['status'] =
    score >= config.thresholds.shortlist ? 'shortlisted' :
    score <= config.thresholds.reject ? 'rejected' : 'prequalified';

  return { score, reasons, status };
}
