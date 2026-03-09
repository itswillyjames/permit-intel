# SPEC-1 — Permit Intel — Migration & Contracts Appendix (Revised)

> Revision date: 2026-03-08

This appendix provides:
- database schema (D1 SQL),
- pipeline JSON contracts,
- idempotency + retry semantics,
- merge/unmerge data rules,
- golden-record fixtures guidance.

## 1) D1 Schema Overview

### Core tables
- `permits`, `permit_sources`, `permit_events`
- `reports`, `report_versions`, `report_events`
- `stage_attempts`, `stage_outputs`, `stage_events`
- `evidence_items`, `evidence_links`, `derived_claims`
- `entities`, `entity_aliases`, `entity_identifiers`, `entity_links`
- `merge_ledger`, `unmerge_ledger`, `operator_locks`
- `exports`, `export_events`
- `report_outcomes`, `comparables`

## 2) DDL (MVP)

> Notes
- Use `TEXT` for UUIDs.
- Timestamps are ISO8601 strings in UTC.
- All append-only event tables are write-only.

```sql
-- PERMITS
CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  source_permit_id TEXT NOT NULL,
  filed_date TEXT,
  issued_date TEXT,
  address_raw TEXT,
  address_norm TEXT,
  work_type TEXT,
  description_raw TEXT,
  valuation INTEGER,
  applicant_raw TEXT,
  contractor_raw TEXT,
  owner_raw TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new|normalized|prequalified|shortlisted|rejected|archived
  prequal_score REAL DEFAULT 0,
  prequal_reasons_json TEXT, -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(city, source_permit_id)
);

CREATE INDEX IF NOT EXISTS idx_permits_city_filed ON permits(city, filed_date);
CREATE INDEX IF NOT EXISTS idx_permits_status_score ON permits(status, prequal_score);
CREATE INDEX IF NOT EXISTS idx_permits_addr_norm ON permits(address_norm);

CREATE TABLE IF NOT EXISTS permit_sources (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  raw_payload_json TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  hash TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);

CREATE TABLE IF NOT EXISTS permit_events (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);

-- REPORTS & VERSIONS
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status_updated ON reports(status, updated_at);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL, -- immutable inputs snapshot
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_id, version),
  FOREIGN KEY(report_id) REFERENCES reports(id)
);

CREATE TABLE IF NOT EXISTS report_events (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);

-- STAGES
CREATE TABLE IF NOT EXISTS stage_attempts (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  input_hash TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_class TEXT,
  error_message TEXT,
  metrics_json TEXT, -- latency, tokens, etc.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_version_id, stage_name, idempotency_key),
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_stage_attempts_rv_stage ON stage_attempts(report_version_id, stage_name);
CREATE INDEX IF NOT EXISTS idx_stage_attempts_status ON stage_attempts(status);

CREATE TABLE IF NOT EXISTS stage_outputs (
  id TEXT PRIMARY KEY,
  stage_attempt_id TEXT NOT NULL,
  output_json TEXT NOT NULL, -- validated
  output_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stage_attempt_id) REFERENCES stage_attempts(id)
);

CREATE TABLE IF NOT EXISTS stage_events (
  id TEXT PRIMARY KEY,
  stage_attempt_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stage_attempt_id) REFERENCES stage_attempts(id)
);

-- EVIDENCE (IMMUTABLE)
CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- web_page|registry|pdf|image|note|model_response
  source TEXT NOT NULL, -- url|city_feed|operator
  title TEXT,
  retrieved_at TEXT NOT NULL,
  hash TEXT NOT NULL,
  storage_ref TEXT, -- inline|kv:key|r2:key
  mime_type TEXT,
  bytes_len INTEGER,
  status TEXT NOT NULL DEFAULT 'active', -- active|deprecated
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence_items(hash);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  link_type TEXT NOT NULL, -- permit|entity|report_version|export
  link_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(evidence_id) REFERENCES evidence_items(id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_links_type_id ON evidence_links(link_type, link_id);

CREATE TABLE IF NOT EXISTS derived_claims (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  claim_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_ids_json TEXT NOT NULL, -- JSON array of evidence ids
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);

-- ENTITIES
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- person|org|place
  canonical_name TEXT NOT NULL,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  source_evidence_id TEXT,
  address_norm TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_alias_norm ON entity_aliases(alias_norm);

CREATE TABLE IF NOT EXISTS entity_identifiers (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  id_type TEXT NOT NULL, -- license|domain|ein|state_reg
  id_value TEXT NOT NULL,
  source_evidence_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(id_type, id_value),
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  link_type TEXT NOT NULL, -- owner_of|contractor_for|architect_for|contact_of
  confidence REAL NOT NULL,
  evidence_ids_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_entity_id);

-- MERGE / UNMERGE
CREATE TABLE IF NOT EXISTS merge_ledger (
  id TEXT PRIMARY KEY,
  winner_entity_id TEXT NOT NULL,
  merged_entity_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  confidence REAL NOT NULL,
  operator_decision TEXT NOT NULL, -- approved|rejected
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unmerge_ledger (
  id TEXT PRIMARY KEY,
  merge_ledger_id TEXT NOT NULL,
  operator_note TEXT,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_locks (
  id TEXT PRIMARY KEY,
  lock_type TEXT NOT NULL, -- entity|alias|identifier
  lock_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(lock_type, lock_id)
);

-- EXPORTS
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  export_type TEXT NOT NULL, -- dossier|playbook|bundle
  template_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|rendering|ready|delivered|failed
  html_storage_ref TEXT,
  pdf_storage_ref TEXT,
  checksum_html TEXT,
  checksum_pdf TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_exports_rv_status ON exports(report_version_id, status);

CREATE TABLE IF NOT EXISTS export_events (
  id TEXT PRIMARY KEY,
  export_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(export_id) REFERENCES exports(id)
);

-- OUTCOMES / COMPARABLES
CREATE TABLE IF NOT EXISTS report_outcomes (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  outcome_type TEXT NOT NULL, -- sold|lost|in_progress|invalid
  revenue_cents INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES reports(id)
);

CREATE TABLE IF NOT EXISTS comparables (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  comparable_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);
```

## 3) Pipeline JSON Contracts (Strict)

### Contract rules
- Output MUST be valid JSON and match the schema.
- No extra top-level keys.
- All strings must be UTF-8 and safe for HTML rendering (escape on render).

Below are **minimal** schemas; expand as needed.

#### Stage: `permit_parse`
```json
{
  "permit": {
    "project_type": "commercial|mixed_use|industrial|institutional|other",
    "scope_summary": "string",
    "estimated_size_sqft": 0,
    "buyer_fit": {
      "score": 0.0,
      "reasons": ["string"]
    }
  }
}
```

#### Stage: `entity_extract`
```json
{
  "entities": [
    {
      "role": "owner|contractor|architect|engineer|applicant",
      "name_raw": "string",
      "name_norm": "string",
      "address_raw": "string",
      "address_norm": "string",
      "identifiers": [
        { "type": "domain|license|state_reg|other", "value": "string" }
      ],
      "confidence": 0.0,
      "evidence": {
        "evidence_ids": ["string"],
        "quotes": ["string"]
      }
    }
  ]
}
```

#### Stage: `contact_discovery`
```json
{
  "contacts": [
    {
      "entity_name_norm": "string",
      "person_name": "string",
      "role": "string",
      "email": "string",
      "phone": "string",
      "linkedin": "string",
      "confidence": 0.0,
      "evidence": { "evidence_ids": ["string"] }
    }
  ]
}
```

#### Stage: `dossier_compose`
```json
{
  "dossier": {
    "headline": "string",
    "summary": "string",
    "project": {
      "address": "string",
      "city": "string",
      "work_type": "string",
      "valuation": 0,
      "timeline": {
        "filed_date": "string",
        "issued_date": "string"
      }
    },
    "key_entities": [
      {
        "role": "string",
        "canonical_name": "string",
        "confidence": 0.0,
        "contacts": ["string"]
      }
    ],
    "recommended_next_steps": ["string"],
    "evidence_index": [
      {
        "evidence_id": "string",
        "title": "string",
        "source": "string",
        "retrieved_at": "string"
      }
    ]
  },
  "playbook": {
    "positioning": ["string"],
    "buyer_targets": ["string"],
    "pricing_logic": ["string"],
    "objections_and_rebuttals": ["string"]
  }
}
```

## 4) Idempotency & Retry Semantics

### Stage idempotency key
`idempotency_key = sha256(report_version_id + stage_name + input_hash + prompt_version)`

- Create `stage_attempts` row **before** calling any provider.
- If the unique constraint hits, return the existing attempt/output.

### Retry policy
- Retry on transport errors, 429, 5xx, or JSON parse failures.
- Do NOT retry on semantic validation failure more than `N` times; after that, mark `failed_terminal` and require operator review.

### Provider fallback
- Each stage may define its own fallback chain.
- Record provider choice + reason in `stage_events`.

## 5) Merge/Unmerge Semantics (Data Rules)

### What “merge” means
- Winner entity remains canonical.
- Merged entity becomes `status = merged` and is no longer shown in UI.
- Aliases and identifiers move to the winner **unless locked**.
- All inbound/outbound `entity_links` are re-pointed.

### Unmerge
- Unmerge restores aliases/identifiers memberships, links, and status flags using `merge_ledger.diff_json`.

## 6) Golden Record Test Pack (Required)

Create a fixture set of **20–50 permits** spanning:
- each city adapter,
- good/bad prequal examples,
- messy contractor/applicant strings,
- duplicate entities with variant names,
- at least 5 permits that should generate high-quality dossiers.

For each fixture:
- expected prequal score band + reasons,
- expected extracted entities,
- expected contacts where available,
- snapshot of the rendered HTML (export snapshot test).
