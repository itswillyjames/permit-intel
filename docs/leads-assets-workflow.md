# Lead Asset Generation Workflow

## Local deterministic bootstrap (no seed endpoint)
```bash
API_KEY=local-dev-key PORT=8787 ./scripts/local_dev_bootstrap.sh
```

## 1) Pick a permit id
```bash
curl -sS -H "x-api-key: $API_KEY" "$BASE/api/permits?limit=1" | jq -r '.permits[0].id'
```

## 2) Generate assets
```bash
curl -sS -X POST -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets/generate" | jq .
```

## 3) List assets
```bash
curl -sS -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets" | jq .
```

## 4) Download each asset
```bash
curl -sS -H "x-api-key: $API_KEY" "$BASE/api/leads/$PERMIT_ID/assets/$ASSET_ID/content" -o ./asset.out
```

## Optional helper script
```bash
API_KEY=... BASE=http://localhost:8787 ./scripts/leads_assets_workflow.sh
```
