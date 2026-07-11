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
