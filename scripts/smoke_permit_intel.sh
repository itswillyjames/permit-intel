#!/usr/bin/env bash
set -euo pipefail

: "${API_KEY:?Set API_KEY first: export API_KEY=...}"
BASE="${BASE:-https://permit-intel-worker.permit-intel.workers.dev}"

command -v jq >/dev/null || { echo "❌ jq not found"; exit 1; }

echo "== Permit Intel Smoke Test =="

echo "1) /api/permits returns real data"
PERMITS_JSON=$(curl -sS -H "x-api-key: $API_KEY" "$BASE/api/permits?limit=5")
COUNT=$(echo "$PERMITS_JSON" | jq -r '.permits | length')
[[ "$COUNT" -ge 1 ]] || { echo "❌ no permits"; exit 1; }
echo "✅ permits count=$COUNT"

PERMIT_ID=$(echo "$PERMITS_JSON" | jq -r '.permits[0].id')

echo "2) /api/leads/:permit_id/ping works"
PING_OK=$(curl -sS -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/ping" | jq -r '.ok')
[[ "$PING_OK" == "true" ]] || { echo "❌ leads ping failed"; exit 1; }
echo "✅ leads ping ok"

echo "3) seed endpoint is not usable"
SEED_CODE=$(curl -sS -o /tmp/seed_resp.txt -w "%{http_code}" -X POST -H "x-api-key: $API_KEY" "$BASE/api/permits/seed")
if [[ "$SEED_CODE" == "404" || "$SEED_CODE" == "405" ]]; then
  echo "✅ seed blocked with $SEED_CODE"
else
  echo "❌ seed endpoint unexpected status=$SEED_CODE"
  cat /tmp/seed_resp.txt
  exit 1
fi

echo "4) generate lead assets"
GEN=$(curl -sS -X POST -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets/generate")
ASSET_COUNT=$(echo "$GEN" | jq -r '.assets | length')
[[ "$ASSET_COUNT" == "4" ]] || { echo "❌ expected 4 assets got $ASSET_COUNT"; echo "$GEN"; exit 1; }
echo "✅ generated 4 assets"

ASSET_ID=$(echo "$GEN" | jq -r '.assets[] | select(.asset_type=="lead_dossier_full") | .export_id' | head -n1)

echo "5) export html auth contract"
NOAUTH_CODE=$(curl -sS -o /tmp/noauth_html.txt -w "%{http_code}" "$BASE/api/exports/$ASSET_ID/html")
[[ "$NOAUTH_CODE" == "401" ]] || { echo "❌ expected 401 for no auth got $NOAUTH_CODE"; exit 1; }
KEY_CODE=$(curl -sS -o /tmp/withkey_html.txt -w "%{http_code}" "$BASE/api/exports/$ASSET_ID/html?key=$API_KEY")
[[ "$KEY_CODE" == "200" ]] || { echo "❌ expected 200 for key auth got $KEY_CODE"; exit 1; }
HEADER_CODE=$(curl -sS -o /tmp/header_html.txt -w "%{http_code}" -H "x-api-key: $API_KEY" "$BASE/api/exports/$ASSET_ID/html")
[[ "$HEADER_CODE" == "200" ]] || { echo "❌ expected 200 for header auth got $HEADER_CODE"; exit 1; }
echo "✅ export html auth contract preserved"

echo "== SMOKE TEST PASSED =="
