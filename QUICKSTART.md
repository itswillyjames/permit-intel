# Permit Intel — Quickstart Guide

> Single-operator commercial permit intelligence workbench.

## Prerequisites

- Node.js 22+ (uses built-in `node:sqlite` for local dev)
- Cloudflare account (for production deployment)
- OpenAI API key (primary) + Anthropic API key (fallback)

---

## Local Development

### 1. Run migrations + seed golden records

```bash
cd permit-intel
node --experimental-sqlite scripts/seed.js
```

This creates `.dev/local.db` with 12 golden-record permits across Chicago, Seattle, and Denver.

### 2. Run the test suite

```bash
node --experimental-sqlite scripts/test-all.mjs
# Expected: 53 tests — 53 passed, 0 failed
```

### 3. Start the API Worker (local)

```bash
cd apps/worker
npx wrangler dev --local --persist-to=../../.dev
```

Worker listens at `http://localhost:8787`.

### 4. Start the Operator UI

```bash
cd apps/operator-ui
# Edit .env.local:
# VITE_API_URL=http://localhost:8787
# VITE_API_KEY=dev-key
npx vite dev
```

UI available at `http://localhost:5173`.

---

## Production Deployment (Cloudflare)

### 1. Create D1 database

```bash
wrangler d1 create permit-intel
# Copy the database_id into apps/worker/wrangler.toml
```

### 2. Apply migrations

```bash
wrangler d1 execute permit-intel --file=packages/db/src/migrations/001_core.sql
wrangler d1 execute permit-intel --file=packages/db/src/migrations/002_evidence.sql
wrangler d1 execute permit-intel --file=packages/db/src/migrations/003_entities.sql
wrangler d1 execute permit-intel --file=packages/db/src/migrations/004_exports.sql
wrangler d1 execute permit-intel --file=packages/db/src/migrations/005_views.sql
```

### 3. Set secrets

```bash
wrangler secret put API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

### 4. Create Queue

```bash
wrangler queues create permit-intel-pipeline
```

### 5. Deploy

```bash
cd apps/worker
wrangler deploy
```

---

## Demo Path (End-to-End)

```bash
# 1. Seed permits
node --experimental-sqlite scripts/seed.js

# 2. Check shortlisted permits via API
curl -H "x-api-key: dev-key" http://localhost:8787/api/permits?status=shortlisted

# 3. Create a report for a permit
PERMIT_ID="<id from step 2>"
curl -X POST -H "x-api-key: dev-key" -H "Content-Type: application/json" \
  -d "{\"permit_id\": \"$PERMIT_ID\"}" \
  http://localhost:8787/api/reports

# 4. Run the pipeline (requires OpenAI key in wrangler dev env)
REPORT_ID="<id from step 3>"
curl -X POST -H "x-api-key: dev-key" \
  http://localhost:8787/api/reports/$REPORT_ID/run

# 5. Check stage progress
curl -H "x-api-key: dev-key" \
  http://localhost:8787/api/reports/$REPORT_ID/stages

# 6. Generate HTML dossier export
REPORT_VERSION_ID="<active_version_id from step 5>"
curl -X POST -H "x-api-key: dev-key" -H "Content-Type: application/json" \
  -d "{\"report_id\": \"$REPORT_ID\", \"report_version_id\": \"$REPORT_VERSION_ID\"}" \
  http://localhost:8787/api/exports

# 7. View dossier
EXPORT_ID="<id from step 6>"
open http://localhost:8787/api/exports/$EXPORT_ID/html
```

---

## Key Architecture Decisions

| Decision | Rationale |
|---|---|
| D1 as system of record | Durable, queryable, Cloudflare-native |
| KV for cache only | Never canonical; safe to flush |
| Queue-driven pipeline | Avoids CF Worker 30s CPU timeout |
| Cheap-first ordering | Prequal runs before any LLM calls |
| Evidence immutable | Audit trail for all derived claims |
| Merge requires operator | Never auto-merge fuzzy matches |
| HTML-first export | PDF derived from canonical HTML |
| Single-tenant | No auth complexity, focus on intelligence quality |

---

## Adding a New City Adapter

1. Create `packages/pipeline/src/ingestion/<city>.ts` implementing `CityAdapter`
2. Implement `fetchSince(cursor)` and `normalize(raw)` 
3. Register in `packages/pipeline/src/ingestion/index.ts`
4. Add fixtures to `scripts/fixtures/golden-records.json`
5. Run tests: `node --experimental-sqlite scripts/test-all.mjs`

## Prequal Tuning

Edit `packages/pipeline/src/prequal/engine.ts` → `DEFAULT_PREQUAL_CONFIG`:
- Raise `minValuation` to filter smaller projects
- Add to `excludeWorkTypes` to filter noise
- Adjust `thresholds.shortlist` (default 0.65)
