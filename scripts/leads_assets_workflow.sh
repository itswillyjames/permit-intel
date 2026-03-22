#!/usr/bin/env bash
set -euo pipefail

: "${API_KEY:?export API_KEY=...}"
BASE="${BASE:-http://localhost:8787}"

command -v jq >/dev/null || { echo "❌ jq not found"; exit 1; }

PERMITS_JSON="$(curl -sS -H "x-api-key: $API_KEY" "$BASE/api/permits?limit=1")"
PERMIT_ID="${1:-$(echo "$PERMITS_JSON" | jq -r '.permits[0].id // empty')}"

if [[ -z "$PERMIT_ID" ]]; then
  echo "❌ No permit_id available at $BASE/api/permits."
  echo "Run scripts/local_dev_bootstrap.sh (local) or point BASE to an environment with data."
  exit 1
fi

OUT_DIR="./tmp/leads/$PERMIT_ID"
mkdir -p "$OUT_DIR"

echo "Using permit_id=$PERMIT_ID"

echo "== Generate assets =="
GEN_RESP="$(curl -sS -X POST -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets/generate")"
echo "$GEN_RESP" | jq .

echo "== List assets =="
ASSETS_JSON="$(curl -sS -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets")"
echo "$ASSETS_JSON" | tee "$OUT_DIR/assets.json" | jq .

echo "== Download assets to $OUT_DIR =="
echo "$ASSETS_JSON" | jq -r '.assets[] | [.file_name,.download_url] | @tsv' | while IFS=$'\t' read -r name url; do
  echo "Downloading $name"
  curl -sS -H "x-api-key: $API_KEY" "$url" -o "$OUT_DIR/$name"
done

echo "✅ Saved files in $OUT_DIR"
