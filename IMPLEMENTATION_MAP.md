# Permit Intel — Implementation Map

> Generated: 2026-03-08  
> Author: Principal Engineer pass

---

## 1. Repo Structure

```
permit-intel/
├── apps/
│   ├── operator-ui/          # Vite + React SPA (operator workbench)
│   │   └── src/
│   │       ├── components/   # PermitTable, ReportQueue, EntityReview, DossierPreview
│   │       ├── pages/        # Shortlist, Reports, Entities, Exports
│   │       ├── hooks/        # usePermits, useReport, useEntity, useExport
│   │       └── lib/          # api client, formatters
│   └── worker/               # Cloudflare Workers entrypoints
│       └── src/
│           ├── routes/       # API routes (permits, reports, entities, exports)
│           ├── consumers/    # Queue consumers (ingest, pipeline, export)
│           └── workflows/    # Durable Workflow orchestrators
│
├── packages/
│   ├── shared/               # Shared across all packages
│   │   └── src/
│   │       ├── schemas/      # Zod schemas (permit, report, stage outputs, export)
│   │       ├── types/        # TypeScript types derived from schemas
│   │       └── utils/        # uuid, hashing, normalization, logger
│   │
│   ├── db/                   # D1 database layer
│   │   └── src/
│   │       ├── migrations/   # 001_core.sql … 005_views.sql
│   │       ├── queries/      # permits.ts, reports.ts, stages.ts, entities.ts,
│   │       │                 #   evidence.ts, exports.ts, merge.ts
│   │       └── __tests__/
│   │
│   ├── pipeline/             # Stage runners + orchestration
│   │   └── src/
│   │       ├── ingestion/    # CityAdapter interface + adapters (chicago, seattle…)
│   │       ├── prequal/      # Rules engine + scoring
│   │       ├── stages/       # permit_parse, entity_extract, contact_discovery,
│   │       │                 #   osint_enrich, dossier_compose
│   │       ├── providers/    # LLMClient + OpenAI/Anthropic/fallback adapters
│   │       ├── validators/   # JSON schema + semantic validators per stage
│   │       └── __tests__/
│   │
│   └── export/               # Dossier rendering
│       └── src/
│           ├── templates/    # dossier.html.ts, playbook.html.ts (versioned)
│           ├── renderers/    # HTMLRenderer, PDFRenderer (interface + impl)
│           └── __tests__/
│
├── docs/
│   ├── IMPLEMENTATION_MAP.md  (this file)
│   ├── QUICKSTART.md
│   └── [original design docs]
│
└── scripts/
    ├── demo.ts               # End-to-end demo path
    └── fixtures/             # Golden record permit fixtures (20-50)
```

---

## 2. Data Model Summary

### Core Tables (D1)

| Table | Purpose | Key Fields |
|---|---|---|
| `permits` | Canonical permit records | id, city, status, prequal_score |
| `permit_sources` | Raw payloads + hash | permit_id, raw_payload_json, hash |
| `permit_events` | Append-only event log | permit_id, event_type |
| `reports` | Logical report container | permit_id, status, active_version_id |
| `report_versions` | Immutable snapshots | report_id, version, snapshot_json |
| `report_events` | Report state log | report_version_id, event_type |
| `stage_attempts` | Stage execution records | report_version_id, stage_name, idempotency_key |
| `stage_outputs` | Validated stage outputs | stage_attempt_id, output_json, output_hash |
| `stage_events` | Stage state + provider log | stage_attempt_id, event_type |
| `evidence_items` | Immutable evidence | type, source, hash, storage_ref |
| `evidence_links` | Evidence ↔ entity/report | evidence_id, link_type, link_id |
| `derived_claims` | AI-extracted claims | report_version_id, claim_json, evidence_ids |
| `entities` | Canonical persons/orgs/places | entity_type, canonical_name |
| `entity_aliases` | Name variants + contact info | entity_id, alias_norm |
| `entity_identifiers` | Strong IDs (license, EIN) | id_type, id_value |
| `entity_links` | Relationships between entities | from_entity_id, to_entity_id, link_type |
| `merge_ledger` | Merge history + diffs | winner_entity_id, merged_entity_id |
| `unmerge_ledger` | Unmerge history | merge_ledger_id, diff_json |
| `operator_locks` | Pinned entities/aliases | lock_type, lock_id |
| `exports` | Export records | report_version_id, status, checksums |
| `export_events` | Export state log | export_id, event_type |
| `report_outcomes` | Post-close outcomes | report_id, outcome_type, revenue_cents |
| `comparables` | Comparable records | report_version_id, comparable_json |

---

## 3. State Machines

### 3a. Permit (`permits.status`)
```
new → normalized → prequalified → shortlisted
                               → rejected (terminal)
any → archived (terminal)
```

### 3b. Report (`reports.status`)
```
draft → queued → running → completed
                         → partial (some optional stages failed)
                         → failed (terminal — required stage failed)
partial/failed → queued  (operator re-run creates new version)
completed/failed → superseded (newer version active)
any → archived
```

### 3c. Stage Attempt (`stage_attempts.status`)
```
queued → running → succeeded
                 → retrying → running (loop up to max_attempts)
                            → failed_retryable (provider unavailable)
                            → failed_terminal (semantic validation fail)
                 → skipped  (gated by operator or upstream failure)
```

### 3d. Export (`exports.status`)
```
draft → rendering → ready → delivered
                  → failed
```

---

## 4. Pipeline Stages

| Stage | Input | Output Contract | Cheap-first? |
|---|---|---|---|
| `permit_parse` | Raw permit fields | `{permit: {project_type, scope_summary, buyer_fit}}` | AI |
| `entity_extract` | Permit + parse output | `{entities: [{role, name_norm, identifiers, confidence}]}` | AI |
| `osint_enrich` | Entity list | Web fetch evidence items | OSINT (no AI) |
| `contact_discovery` | Enriched entities | `{contacts: [{person_name, email, phone, confidence}]}` | AI |
| `dossier_compose` | All prior outputs | `{dossier: {...}, playbook: {...}}` | AI |

**Cheap-first ordering**: prequal score is computed deterministically before any stage is triggered. Stages gate on prequal threshold. `osint_enrich` is free (web fetch). AI stages run last.

---

## 5. Entity Resolution Policy

| Match Tier | Rule | Action |
|---|---|---|
| Exact | Same strong identifier OR normalized name + exact address + confidence ≥ 0.95 | Auto-link (no merge) |
| Probable | Fuzzy name similarity ≥ 0.85 + partial address | Queue for operator review |
| Possible | Weak similarity | Store as `candidate_link` only, never auto-merge |

Merges always require explicit operator confirmation (even exact matches create suggestions; merge is a separate confirm action unless operator has enabled `auto_merge_exact` flag).

---

## 6. Build Sequence (implemented in this order)

1. ✅ Implementation Map (this doc)
2. D1 schema + migrations + query layer + seed fixtures
3. State machine library + transition validators + tests
4. Ingestion adapters + normalization + prequal scoring + tests
5. Pipeline orchestration (queue, workflow, stage attempts, provider abstraction)
6. Entity resolution (canonicalization, suggestions, merge/unmerge)
7. Evidence archive + snapshot semantics
8. Export rendering (HTML dossier + PDF)
9. Operator UI (permit list, report queue, entity review, export download)
10. Hardening (rate limiting, sanitization, performance, CI regression)

---

## 7. Key Assumptions

1. **Runtime**: Cloudflare Workers + D1 + Queues. Local dev uses Miniflare/Wrangler.
2. **AI Provider**: OpenAI (primary) → Anthropic (fallback). Both implement the same `LLMProvider` interface.
3. **PDF**: HTML→PDF via `puppeteer` in a separate render Worker (or external service). Interface is abstracted so it can be swapped.
4. **KV usage**: Cache only (web page text, temporary enrichment). TTL = 24h. Never used as system of record.
5. **R2**: Optional. `storage_ref` field supports `inline:` (small, <64KB base64), `kv:<key>`, `r2:<key>` prefixes. MVP defaults to `inline:` for PDFs.
6. **No multi-tenancy**: All data belongs to one operator. No auth beyond a static API key in worker env.
7. **Prequal config**: Stored as JSON in a config file (not DB). Operator edits file and redeploys.
8. **LLM prompt versioning**: Each stage has a `PROMPT_VERSION` constant used in idempotency key.
