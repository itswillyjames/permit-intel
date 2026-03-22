#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
API_KEY="${API_KEY:-local-dev-key}"
WORKER_CONFIG="apps/worker/wrangler.toml"
D1_NAME="permit-intel"
D1_STATE_DIR="apps/worker/.wrangler/state/v3/d1"

command -v jq >/dev/null || { echo "❌ jq not found"; exit 1; }
WRANGLER_BIN="${WRANGLER_BIN:-npx wrangler}"

# Validate wrangler is runnable (local install via npx is supported)
if ! ${WRANGLER_BIN} --version >/dev/null 2>&1; then
  echo "❌ wrangler not found (set WRANGLER_BIN or install wrangler)"
  exit 1
fi

echo "== Reset local D1 state =="
rm -rf "$D1_STATE_DIR"

echo "== Run migrations 001-006 on local D1 =="
for migration in packages/db/src/migrations/00{1,2,3,4,5,6}_*.sql; do
  echo "Applying $migration"
  ${WRANGLER_BIN} d1 execute "$D1_NAME" --local --config "$WORKER_CONFIG" --file "$migration" >/dev/null
done

echo "== Insert deterministic dev permit + permit_source =="
TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
${WRANGLER_BIN} d1 execute "$D1_NAME" --local --config "$WORKER_CONFIG" --command "
INSERT INTO permits (
  id, city, source_permit_id, filed_date, issued_date, address_raw, address_norm,
  work_type, description_raw, valuation, applicant_raw, contractor_raw, owner_raw,
  status, prequal_score, created_at, updated_at
) VALUES (
  'dev-permit-001', 'Austin', 'DEV-101077569', '2026-01-10', '2026-01-20',
  '123 Demo St, Austin, TX', '123 DEMO ST, AUSTIN, TX', 'Kitchen Remodel',
  'Interior remodel and electrical upgrades.', 185000, 'Acme Home LLC',
  'BuildRight Contractors', 'Jamie Owner', 'prequalified', 0.91, '${TS}', '${TS}'
);

INSERT INTO permit_sources (
  id, permit_id, source_name, source_url, raw_payload_json, retrieved_at, hash
) VALUES (
  'dev-source-001', 'dev-permit-001', 'city_portal', 'https://example.local/permits/DEV-101077569',
  '{\"permit\":\"DEV-101077569\",\"city\":\"Austin\"}', '${TS}', 'devhash-001'
);
" >/dev/null

echo "== Start worker on ${BASE} =="
LOG_FILE="/tmp/permit-intel-worker.log"
rm -f "$LOG_FILE"
API_KEY="$API_KEY" ${WRANGLER_BIN} dev --local --config "$WORKER_CONFIG" --port "$PORT" --var "API_KEY:${API_KEY}" >"$LOG_FILE" 2>&1 &
WORKER_PID=$!
cleanup() {
  if kill -0 "$WORKER_PID" 2>/dev/null; then
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if grep -Eq "Ready on|listening|http://127.0.0.1:${PORT}" "$LOG_FILE"; then
    break
  fi
  sleep 1
done

if ! grep -Eq "Ready on|listening|http://127.0.0.1:${PORT}" "$LOG_FILE"; then
  echo "❌ Worker did not start in time"
  tail -n 100 "$LOG_FILE"
  exit 1
fi

echo "== Run smoke checks =="
BASE="$BASE" API_KEY="$API_KEY" scripts/smoke_permit_intel.sh

echo "✅ Local bootstrap complete"
