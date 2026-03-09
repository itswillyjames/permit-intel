// packages/pipeline/src/stages/runners.ts
// Concrete stage runners for all pipeline stages.

import type {
  PermitParseOutput,
  EntityExtractOutput,
  ContactDiscoveryOutput,
  DossierComposeOutput,
} from "@permit-intel/shared";
import type { LLMCallInput } from "../providers/llm-client.js";
import { BaseStageRunner } from "./base-runner.js";

// ============================================================
// permit_parse
// ============================================================

export interface PermitParseInput {
  city: string;
  address: string;
  work_type: string;
  description: string;
  valuation: number | null;
  applicant: string;
  contractor: string;
  filed_date: string;
}

export class PermitParseRunner extends BaseStageRunner<
  PermitParseInput,
  PermitParseOutput
> {
  readonly stageName = "permit_parse";

  protected buildPrompt(input: PermitParseInput): LLMCallInput {
    return {
      prompt: `stage: permit_parse

You are analyzing a building permit record. Classify it and assess commercial real estate broker fit.

Permit details:
- City: ${input.city}
- Address: ${input.address}
- Work Type: ${input.work_type}
- Description: ${input.description}
- Valuation: ${input.valuation ?? "not specified"}
- Applicant: ${input.applicant}
- Contractor: ${input.contractor}
- Filed: ${input.filed_date}

Respond with ONLY a JSON object matching this schema exactly:
{
  "permit": {
    "project_type": "<commercial|mixed_use|industrial|institutional|other>",
    "scope_summary": "<1-2 sentence description of what's being built/renovated>",
    "estimated_size_sqft": <number or 0 if unknown>,
    "buyer_fit": {
      "score": <0.0 to 1.0>,
      "reasons": ["<reason 1>", "<reason 2>"]
    }
  }
}`,
      maxTokens: 512,
      temperature: 0,
    };
  }

  protected castOutput(validated: unknown): PermitParseOutput {
    return validated as PermitParseOutput;
  }
}

// ============================================================
// entity_extract
// ============================================================

export interface EntityExtractInput {
  permit_id: string;
  address: string;
  city: string;
  description: string;
  applicant_raw: string;
  contractor_raw: string;
  owner_raw: string;
  scope_summary: string;
  evidence_ids: string[];
}

export class EntityExtractRunner extends BaseStageRunner<
  EntityExtractInput,
  EntityExtractOutput
> {
  readonly stageName = "entity_extract";

  protected buildPrompt(input: EntityExtractInput): LLMCallInput {
    return {
      prompt: `stage: entity_extract

Extract all named entities from this permit record.

Permit:
- Address: ${input.address}, ${input.city}
- Description: ${input.description}
- Scope: ${input.scope_summary}
- Applicant: ${input.applicant_raw}
- Contractor: ${input.contractor_raw}
- Owner: ${input.owner_raw}

Evidence IDs available: ${input.evidence_ids.join(", ")}

Respond with ONLY a JSON object matching this schema:
{
  "entities": [
    {
      "role": "<owner|contractor|architect|engineer|applicant>",
      "name_raw": "<exact name as it appears>",
      "name_norm": "<normalized lowercase name>",
      "address_raw": "<address as it appears, or empty string>",
      "address_norm": "<normalized address, or empty string>",
      "identifiers": [
        { "type": "<domain|license|state_reg|other>", "value": "<value>" }
      ],
      "confidence": <0.0 to 1.0>,
      "evidence": {
        "evidence_ids": ["<evidence_id>"],
        "quotes": ["<exact text quoted from source>"]
      }
    }
  ]
}

Include all unique entities. Do not duplicate.`,
      maxTokens: 2048,
      temperature: 0,
    };
  }

  protected castOutput(validated: unknown): EntityExtractOutput {
    return validated as EntityExtractOutput;
  }
}

// ============================================================
// contact_discovery
// ============================================================

export interface ContactDiscoveryInput {
  entities: Array<{
    entity_id: string;
    canonical_name: string;
    role: string;
    address: string;
  }>;
  evidence_ids: string[];
  osint_text: string; // aggregated web/registry text
}

export class ContactDiscoveryRunner extends BaseStageRunner<
  ContactDiscoveryInput,
  ContactDiscoveryOutput
> {
  readonly stageName = "contact_discovery";

  protected buildPrompt(input: ContactDiscoveryInput): LLMCallInput {
    const entityList = input.entities
      .map((e) => `- ${e.role}: ${e.canonical_name} (${e.address})`)
      .join("\n");

    return {
      prompt: `stage: contact_discovery

Find contact information for these commercial real estate entities.

Entities:
${entityList}

OSINT data gathered:
${input.osint_text.slice(0, 6000)}

Evidence IDs: ${input.evidence_ids.join(", ")}

Respond with ONLY a JSON object:
{
  "contacts": [
    {
      "entity_name_norm": "<normalized entity name>",
      "person_name": "<person full name or empty string>",
      "role": "<title/role>",
      "email": "<email or empty string>",
      "phone": "<phone or empty string>",
      "linkedin": "<linkedin url or empty string>",
      "confidence": <0.0 to 1.0>,
      "evidence": { "evidence_ids": ["<id>"] }
    }
  ]
}

Only include contacts where confidence >= 0.3. Include empty string for unknown fields.`,
      maxTokens: 2048,
      temperature: 0,
    };
  }

  protected castOutput(validated: unknown): ContactDiscoveryOutput {
    return validated as ContactDiscoveryOutput;
  }
}

// ============================================================
// dossier_compose
// ============================================================

export interface DossierComposeInput {
  permit: {
    id: string;
    address: string;
    city: string;
    work_type: string;
    description: string;
    valuation: number | null;
    filed_date: string;
    issued_date: string;
    scope_summary: string;
  };
  entities: Array<{
    role: string;
    canonical_name: string;
    confidence: number;
    contacts: string[];
  }>;
  evidence_index: Array<{
    evidence_id: string;
    title: string;
    source: string;
    retrieved_at: string;
  }>;
}

export class DossierComposeRunner extends BaseStageRunner<
  DossierComposeInput,
  DossierComposeOutput
> {
  readonly stageName = "dossier_compose";

  protected buildPrompt(input: DossierComposeInput): LLMCallInput {
    return {
      prompt: `stage: dossier_compose

You are a commercial real estate intelligence analyst. Compose a broker-ready dossier.

Project:
- Address: ${input.permit.address}, ${input.permit.city}
- Work Type: ${input.permit.work_type}
- Valuation: $${(input.permit.valuation ?? 0).toLocaleString()}
- Filed: ${input.permit.filed_date}
- Issued: ${input.permit.issued_date}
- Scope: ${input.permit.scope_summary}
- Description: ${input.permit.description}

Key Entities:
${input.entities.map((e) => `- ${e.role}: ${e.canonical_name} (confidence: ${e.confidence})`).join("\n")}

Evidence Sources: ${input.evidence_index.length} items

Respond with ONLY a JSON object:
{
  "dossier": {
    "headline": "<compelling 1-line headline>",
    "summary": "<2-3 sentence executive summary>",
    "project": {
      "address": "${input.permit.address}",
      "city": "${input.permit.city}",
      "work_type": "${input.permit.work_type}",
      "valuation": ${input.permit.valuation ?? 0},
      "timeline": {
        "filed_date": "${input.permit.filed_date}",
        "issued_date": "${input.permit.issued_date}"
      }
    },
    "key_entities": [
      { "role": "<role>", "canonical_name": "<name>", "confidence": <0-1>, "contacts": ["<contact>"] }
    ],
    "recommended_next_steps": ["<step 1>", "<step 2>", "<step 3>"],
    "evidence_index": ${JSON.stringify(input.evidence_index)}
  },
  "playbook": {
    "positioning": ["<positioning point>"],
    "buyer_targets": ["<target buyer type>"],
    "pricing_logic": ["<pricing consideration>"],
    "objections_and_rebuttals": ["<objection: rebuttal>"]
  }
}`,
      maxTokens: 4096,
      temperature: 0.2,
    };
  }

  protected castOutput(validated: unknown): DossierComposeOutput {
    return validated as DossierComposeOutput;
  }
}
