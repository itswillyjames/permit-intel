#!/usr/bin/env bash
set -euo pipefail

: "${API_KEY:?Set API_KEY first: export API_KEY=...}"

BASE="${BASE:-https://permit-intel-worker.permit-intel.workers.dev}"
DB_NAME="${DB_NAME:-permit-intel}"
REPO_ROOT="${REPO_ROOT:-$HOME/tmp/permit-intel}"

command -v wrangler >/dev/null || { echo "❌ wrangler not found"; exit 1; }
command -v jq >/dev/null || { echo "❌ jq not found (sudo apt-get install -y jq)"; exit 1; }

WORKER_DIR="$REPO_ROOT/apps/worker"
if [[ ! -d "$WORKER_DIR" ]]; then
  echo "❌ WORKER_DIR not found: $WORKER_DIR"
  echo "Set REPO_ROOT correctly (export REPO_ROOT=...)"
  exit 1
fi
cd "$WORKER_DIR"

echo "== Permit Intel Smoke Test =="
echo "BASE=$BASE"
echo "DB_NAME=$DB_NAME"
echo "REPO_ROOT=$REPO_ROOT"
echo

echo "1) GET /api/permits"
curl -sS -H "x-api-key: $API_KEY" "$BASE/api/permits" >/dev/null
echo "✅ permits reachable"
echo

echo "2) Try seed (skip if disabled)"
SEED_RESP=$(curl -sS -X POST -H "x-api-key: $API_KEY" "$BASE/api/permits/seed" || true)
if echo "$SEED_RESP" | jq -e . >/dev/null 2>&1; then
  # If DISABLE_SEED=true it should return JSON error with 403; still fine for smoke
  echo "$SEED_RESP" | jq .
  echo "✅ seed endpoint reachable"
else
  echo "⚠ seed returned non-JSON (continuing):"
  echo "$SEED_RESP"
fi
echo

echo "3) Pick first permit"
PERMIT_ID=$(curl -sS -H "x-api-key: $API_KEY" "$BASE/api/permits" | jq -r '.permits[0].id')
if [[ -z "$PERMIT_ID" || "$PERMIT_ID" == "null" ]]; then
  echo "❌ Could not select permit_id"
  exit 1
fi
echo "✅ PERMIT_ID=$PERMIT_ID"
echo

echo "4) Create report"
REPORT_ID=$(curl -sS -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"permit_id\":\"$PERMIT_ID\"}" "$BASE/api/reports" | jq -r '.report.id')
if [[ -z "$REPORT_ID" || "$REPORT_ID" == "null" ]]; then
  echo "❌ Could not create report"
  exit 1
fi
echo "✅ REPORT_ID=$REPORT_ID"
echo

echo "5) Run pipeline (queues job)"
RV=$(curl -sS -X POST -H "x-api-key: $API_KEY" "$BASE/api/reports/$REPORT_ID/run" | jq -r '.report_version.id')
if [[ -z "$RV" || "$RV" == "null" ]]; then
  echo "❌ Could not queue pipeline / get report_version_id"
  exit 1
fi
echo "✅ queued REPORT_VERSION_ID=$RV"
echo

echo "6) Wait for report_version status (poll D1 up to 240s)"
STATUS=""
for i in $(seq 1 80); do
  STATUS=$(wrangler d1 execute "$DB_NAME" --remote \
    --command="SELECT status FROM report_versions WHERE id='$RV';" --json \
    | jq -r '.[0].results[0].status')
  echo "[$i] status=$STATUS"
  if [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]]; then
    break
  fi
  sleep 3
done

if [[ "$STATUS" != "completed" ]]; then
  echo "❌ Pipeline did not complete successfully (status=$STATUS)"
  wrangler d1 execute "$DB_NAME" --remote \
    --command="SELECT stage_name, status, provider, model_id, error_class, error_message, created_at, updated_at FROM stage_attempts WHERE report_version_id='$RV' ORDER BY created_at ASC;"
  exit 1
fi
echo "✅ pipeline completed"
echo

echo "7) Render export (HTML dossier -> R2)"
EXPORT_ID=$(curl -sS -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"report_id\":\"$REPORT_ID\",\"report_version_id\":\"$RV\"}" \
  "$BASE/api/exports" | jq -r '.export_id')
if [[ -z "$EXPORT_ID" || "$EXPORT_ID" == "null" ]]; then
  echo "❌ Export render failed"
  exit 1
fi
echo "✅ EXPORT_ID=$EXPORT_ID"
echo

echo "8) Verify D1 export has r2 storage ref"
wrangler d1 execute "$DB_NAME" --remote \
  --command="SELECT id, status, html_storage_ref, checksum_html, created_at FROM exports WHERE id='$EXPORT_ID';"
R2REF=$(wrangler d1 execute "$DB_NAME" --remote \
  --command="SELECT html_storage_ref FROM exports WHERE id='$EXPORT_ID';" --json \
  | jq -r '.[0].results[0].html_storage_ref')

if [[ -z "$R2REF" || "$R2REF" == "null" ]]; then
  echo "❌ html_storage_ref is null (export not persisted)"
  exit 1
fi

if [[ "$R2REF" != r2:* ]]; then
  echo "❌ html_storage_ref is not r2:* (got $R2REF)"
  exit 1
fi
echo "✅ R2REF=$R2REF"
echo

echo "9) Verify Worker serves HTML from R2"
curl -sS -H "x-api-key: $API_KEY" "$BASE/api/exports/$EXPORT_ID/html" | head -n 3
echo "✅ Worker HTML endpoint OK"
echo

echo "10) Verify R2 object exists + contains Permit Intel Dossier"
R2KEY="${R2REF#r2:}"
wrangler r2 object get "permit-intel-exports/$R2KEY" --file /tmp/dossier.html --remote >/dev/null
grep -q "Permit Intel Dossier" /tmp/dossier.html
echo "✅ R2 HTML check PASS (Permit Intel Dossier present)"
echo

echo "== SMOKE TEST PASSED =="
echo "PERMIT_ID=$PERMIT_ID"
echo "REPORT_ID=$REPORT_ID"
echo "REPORT_VERSION_ID=$RV"
echo "EXPORT_ID=$EXPORT_ID"
