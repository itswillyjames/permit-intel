# SPEC-1 — Permit Intel — Ticket-Ready Backlog (Revised)

> Revision date: 2026-03-08

This backlog is sized for a small contractor team delivering an MVP quickly, while protecting the high-risk areas (state machines, contracts, merge semantics).

## EPIC A — Foundations (State Machines, Contracts, Idempotency) (MUST)

**A1. Canonical state model**
- Implement status enums for permits, reports, stages, exports.
- Add append-only event tables and helper functions.
- Acceptance: all transitions go through a single service module; events emitted.

**A2. Report versioning**
- Implement `reports` + `report_versions` + `active_version_id`.
- Snapshot creation at report start.
- Acceptance: regeneration creates a new version without mutating prior outputs.

**A3. Stage attempt idempotency + retries**
- Unique idempotency key enforcement.
- Retry + fallback logic with provider events.
- Acceptance: rerunning a stage with same key returns same output; no duplicates.

**A4. Strict JSON validation + semantic validation**
- JSON schema validator per stage.
- Semantic rules (confidence thresholds, required evidence refs).
- Acceptance: invalid outputs are rejected and retried per policy; audit trail saved.

## EPIC B — Ingest & Prequal (MUST)

**B1. City adapters**
- Implement adapters for listed cities.
- Normalize fields into `permits`.
- Acceptance: each adapter can ingest into D1; ingestion runs are logged.

**B2. Deterministic prequalification**
- Rules engine + scoring.
- Store `prequal_reasons_json`.
- Acceptance: operator can review reasons and tune thresholds.

**B3. Shortlist UI view**
- Search/sort by city/date/score/work type/valuation.
- Acceptance: shortlist loads fast (index-backed) and supports saved filters.

## EPIC C — Pipeline Orchestration (MUST)

**C1. Orchestrator**
- Queue/workflow execution with stage DAG and gating.
- Acceptance: stages run in order; failures mark partial/failed appropriately.

**C2. LLM provider wrapper**
- Unified client with telemetry + fallback chain.
- Acceptance: switching providers requires no stage code changes.

**C3. OSINT connectors**
- Web fetch, registry checks, operator notes as evidence.
- Acceptance: all connectors emit evidence items and links.

## EPIC D — Evidence & Claims (MUST)

**D1. Immutable evidence store**
- `evidence_items` + `evidence_links` + hashing.
- Acceptance: evidence is append-only; deprecations do not delete.

**D2. Derived claims**
- Extract key claims and require evidence ids.
- Acceptance: every high-impact claim in dossier references evidence.

## EPIC E — Entity Graph (SHOULD)

**E1. Entity objects + aliases + identifiers**
- Create entities from `entity_extract`.
- Acceptance: aliases retain source evidence.

**E2. Match tiers + review queue**
- Exact matches auto-link; probable matches require operator approval.
- Acceptance: fuzzy match never auto-merges; requires explicit review.

**E3. Merge/unmerge**
- Merge ledger diff capture; unmerge restores state.
- Acceptance: unmerge reverses a merge without data loss.

## EPIC F — Exports (MUST)

**F1. HTML renderer**
- Template versioning; render dossier + playbook as HTML.
- Acceptance: HTML export reproducible from snapshot.

**F2. PDF renderer**
- HTML-to-PDF derivation with checksums.
- Acceptance: PDF matches HTML snapshot; stored via storage refs.

**F3. Export manifest**
- Bundle export with index + evidence list.
- Acceptance: operator can download/share a single bundle per report version.

## EPIC G — Retrieval Projections (SHOULD)

**G1. Search views**
- `permit_search_view`, `entity_activity_view`, `contact_directory_view`.
- Acceptance: top 10 operator queries complete in acceptable time.

**G2. Saved searches**
- Save query JSON; re-run on demand.
- Acceptance: saved searches persist and return consistent results.

## EPIC H — Golden Records & QA (MUST)

**H1. Fixture pack**
- Build 20–50 permit fixtures + expected outputs.
- Acceptance: fixtures run in CI; key outputs snapshot-tested.

**H2. Provider failure simulations**
- Mock 429/5xx/invalid JSON to validate fallback logic.
- Acceptance: orchestrator recovers and produces audit trail.
