# Production Container Deployment (Budget-Safe)

This repo can deploy Web and API as containers on the existing App Service plan.

## Cost guardrails

- Keep the existing `B1` Linux App Service plan shared by both apps.
- Add one Azure Container Registry with `Basic` SKU.
- This avoids AKS and keeps costs predictable.

## One-time Azure setup

1. Create ACR (Basic):

```bash
az acr create \
  --resource-group workforce-rg \
  --name <your-acr-name> \
  --sku Basic \
  --admin-enabled true
```

2. Capture registry details:

```bash
az acr show --name <your-acr-name> --query "{loginServer:loginServer}" -o tsv
az acr credential show --name <your-acr-name> --query "{username:username,password:passwords[0].value}" -o json
```

3. Configure production environment in GitHub:

- Variable:
  - `CONTAINER_REGISTRY_SERVER` (e.g. `myacr.azurecr.io`)
- Secrets:
  - `CONTAINER_REGISTRY_USERNAME`
  - `CONTAINER_REGISTRY_PASSWORD`
  - `AZURE_CREDENTIALS`
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

## Deploy

Use workflow `Deploy Production Containers` and choose target:

- `all` for both services
- `web` for web only
- `api` for api only

Images are tagged with `sha-<short_commit>` and pushed before App Service is updated.

## Database schema changes

The deploy runs `prisma db push` **before** any container is deployed, so the
schema is reconciled first (or the whole deployment halts). The `run_migration`
input controls this: `auto` (default) runs it only when `schema.prisma` changed
since the last prod release; `always` / `never` force it.

### Non-destructive (additive) changes — automatic

Adding tables, columns, indexes, or enum values is applied automatically by
`prisma db push`. Nothing extra is required — merge and deploy as usual.

### Destructive changes — deployment halts on purpose

The pipeline **never** passes `--accept-data-loss`. If a change would drop or
rename a column, table, or enum value, `prisma db push` refuses it and the deploy
step **fails with a clear error and prints the detected schema diff** (also written
to the run summary). No container is deployed, so production is never left
partially updated or silently drifted. A post-push zero-drift check also fails the
deploy if any change was left unapplied.

When you hit that failure, perform a reviewed one-time manual reconciliation:

1. **Generate and review the diff.**
   ```bash
   # DATABASE_URL must point at the target DB (inline; do NOT rely on .env).
   DATABASE_URL="<prod-url>" \
     npx prisma migrate diff \
       --from-url "$DATABASE_URL" \
       --to-schema-datamodel packages/database/prisma/schema.prisma --script
   ```
   Confirm every destructive operation is expected and in scope. Stop if anything
   unexpected appears.
2. **Verify affected data.** Row-count every table/column being dropped; confirm
   it is empty or already obsolete and unused by the app.
3. **Take and verify a backup.**
   ```bash
   pg_dump "$DATABASE_URL" --no-owner --no-privileges -f prod-backup-<ts>.sql
   grep -q "PostgreSQL database dump complete" prod-backup-<ts>.sql && echo OK
   ```
   Store it in durable (non-`/tmp`) storage and record the location.
4. **Apply the one-time reviewed change manually.**
   ```bash
   DATABASE_URL="$DATABASE_URL" \
     npx prisma db push --schema packages/database/prisma/schema.prisma \
       --accept-data-loss --skip-generate
   ```
5. **Verify zero drift.** Re-run the diff from step 1 — it must be empty. Spot-check
   that retained tables/columns and data are intact.
6. **Rerun the normal deployment.** With the schema already reconciled, the
   pipeline's `db push` is a no-op and the deploy proceeds normally.

> Never add `--accept-data-loss` to the workflow, and never add a fallback that
> ignores a failed migration step. Destructive changes are always an explicit,
> reviewed, one-time decision.

