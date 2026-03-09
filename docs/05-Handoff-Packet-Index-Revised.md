# Permit Intel — Revised Handoff Packet Index

> Revision date: 2026-03-08

## What’s in this packet

1. **01-Architecture-Spec-Revised.md**
   - End-to-end architecture
   - Canonical state machines
   - Evidence + version semantics
   - Entity resolution policy
   - Export rendering strategy
   - Retrieval projections

2. **02-Migration-and-Contracts-Appendix-Revised.md**
   - D1 schema (SQL)
   - Pipeline JSON contracts
   - Idempotency + retry rules
   - Merge/unmerge semantics
   - Golden record test pack requirements

3. **03-Ticket-Ready-Backlog-Revised.md**
   - Epics + stories with acceptance criteria

4. **04-Engineering-Task-Backlog-Revised.md**
   - Sprint-level task plan

5. **05-Handoff-Packet-Index-Revised.md**
   - This index and how to use the packet

## Conventions

- All IDs are UUID strings.
- All times stored as ISO8601 UTC strings.
- Evidence is immutable; derived outputs are versioned.
- Regenerating a report creates a new `report_version`.

## MVP build order (recommended)

1. Migrations + state machine module
2. Ingest one city + prequal + shortlist UI
3. Report versioning + stage attempt idempotency
4. One AI stage end-to-end with strict validation
5. Evidence + export HTML
6. Entity graph + review/merge
7. PDF rendering + bundle export
8. Golden record fixtures + CI regression suite
