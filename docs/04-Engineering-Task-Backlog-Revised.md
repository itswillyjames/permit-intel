# SPEC-1 — Permit Intel — Engineering Task Backlog (Revised)

> Revision date: 2026-03-08  
> Purpose: granular tasks suitable for contractor sprint planning.

## Sprint 0 — Repo + Tooling
- Set up monorepo structure (ui/, worker-api/, worker-ingest/, shared/).
- Add linting, formatting, unit test harness.
- Add migration runner and seed scripts for D1.

## Sprint 1 — Data Layer + State Machines
- Implement D1 migrations from Appendix (core + events).
- Implement `state.ts` (or equivalent) with:
  - enums,
  - allowed transitions,
  - transition helpers that emit events.
- Implement report version snapshot creation.

Acceptance
- Any invalid state transition fails fast.
- Event tables show a complete timeline for a test report.

## Sprint 2 — Ingest + Prequal
- Build adapter interface:
  - `fetch_since(cursor) -> raw_rows`
  - `normalize(raw) -> permit`
  - `upsert(permit)`
- Implement prequal rules engine with config file.
- Create shortlist query endpoint + UI table.

Acceptance
- Ingest produces normalized permits for at least 1 city end-to-end.
- Prequal reasons visible in UI.

## Sprint 3 — Orchestration + Stage Attempts
- Implement orchestrator DAG:
  - stage dependencies,
  - gating,
  - required vs optional stages.
- Implement stage attempt creation with idempotency key.
- Implement `LLMClient` wrapper:
  - provider adapters,
  - JSON schema validation,
  - semantic validation hooks,
  - retry + fallback.

Acceptance
- Re-running the same stage returns the same output without duplicate rows.
- Fallback is recorded in `stage_events`.

## Sprint 4 — Evidence + OSINT
- Implement evidence hashing and storage ref abstraction.
- Implement web fetch connector as evidence.
- Implement operator note evidence type.
- Implement derived claims table writes from stage outputs.

Acceptance
- Every OSINT fetch creates an `evidence_item` and a `evidence_link`.
- Dossier can list evidence index from the DB.

## Sprint 5 — Entity Graph + Review
- Implement entity creation from `entity_extract`.
- Implement exact-match auto-linking.
- Implement probable-match review queue in UI.
- Implement merge ledger and unmerge action.

Acceptance
- Fuzzy matches never auto-merge.
- Unmerge reverses a merge and restores aliases/links.

## Sprint 6 — Export Rendering
- Implement HTML templates + template versioning.
- Implement PDF renderer (service or headless browser) behind interface.
- Implement export manifest bundling.

Acceptance
- Exports are reproducible from a `report_version_id`.
- Checksums stored and verified.

## Sprint 7 — Retrieval Projections + Saved Searches
- Implement search views and indexes.
- Add saved search CRUD and execution.

Acceptance
- Top operator queries are fast and stable.

## Sprint 8 — Golden Records + CI
- Add fixture dataset and expected outputs.
- Add snapshot tests for HTML exports.
- Add provider failure simulation tests.

Acceptance
- CI runs fixture pack and catches regression in scoring/contracts/exports.
