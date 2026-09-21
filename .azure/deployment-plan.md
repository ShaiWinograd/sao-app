# Azure Deployment Plan

> **Status:** Deployed

Generated: 2026-09-21T15:05:00+03:00

---

## 1. Project Overview

**Goal:** Deploy the Space & Order scheduling redesign as quickly and safely as possible, including the additive trainee payroll fields and both web/API changes.

**Path:** Modify existing production application.

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Production POC / October pilot |
| Scale | Small |
| Budget | Existing resources; no new recurring resources |
| Subscription | Visual Studio Enterprise Subscription (`fdb353b1-3b56-4c72-bd66-fbbe625d8a96`) — confirmed |
| Location | Existing `workforce-rg` resources in Israel Central — confirmed |

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| Owner and worker web application | Frontend | Next.js 15 / React | `apps/web` |
| Workforce API | API | Fastify / Node.js 22 / Prisma | `packages/api` |
| Shared business logic | Library | TypeScript | `packages/shared` |
| Workforce database schema | Database | PostgreSQL / Prisma | `packages/database/prisma/schema.prisma` |

---

## 4. Recipe Selection

**Selected:** Existing Azure CLI deployment recipe through GitHub Actions.

**Rationale:** The repository already has a proven production workflow, `.github/workflows/deploy-prod-containers.yml`, with Azure authentication, ACR image publishing, additive Prisma schema reconciliation, App Service container updates, health verification, and release creation. Creating parallel IaC or AZD configuration would add risk and delay.

---

## 5. Architecture

**Stack:** Existing Linux App Service containers.

### Service Mapping

| Component | Azure Service | Deployment |
|-----------|---------------|------------|
| Web | Azure App Service `spaceorder-web-app-poc2` | Container image from existing ACR |
| API | Azure App Service `spaceorder-api-app-poc` | Container image from existing ACR |
| Database | Azure Database for PostgreSQL Flexible Server `sao-workforce-db` | Additive `prisma db push` before containers |
| Images | Existing Azure Container Registry | SHA-tagged web and API images |

### Supporting Services

No new Azure resources are introduced. Existing GitHub production environment secrets and variables provide Azure credentials, registry access, Clerk configuration, and public URLs.

---

## 6. Provisioning Limit Checklist

The deployment updates existing resources and provisions **zero** new Azure resources. Azure quota capacity is therefore not consumed by this release.

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Microsoft.Web/sites | 0 new | Existing count unchanged | Not applicable | Existing web/API App Services are updated in place |
| Microsoft.ContainerRegistry/registries | 0 new | Existing count unchanged | Not applicable | Images are pushed to the existing registry |
| Microsoft.DBforPostgreSQL/flexibleServers | 0 new | Existing count unchanged | Not applicable | Additive columns only; production workflow refuses destructive changes |

**Status:** ✅ No provisioning quota required.

---

## 7. Execution Checklist

### Phase 1: Planning
- [x] Analyze workspace
- [x] Gather requirements
- [x] Confirm subscription, location, and production target with user
- [x] Prepare resource inventory
- [x] Validate capacity: no new resources
- [x] Scan codebase
- [x] Select existing deployment recipe
- [x] Plan architecture
- [x] User approved this plan

### Phase 2: Execution
- [x] Commit the validated application changes
- [x] Integrate the latest `origin/main` without conflicts
- [x] Push the deployment branch
- [x] Verify GitHub production workflow configuration
- [x] Update status to `Ready for Validation`

### Phase 3: Validation
- [x] Invoke azure-validate workflow
- [x] Validate repository, images, schema change, GitHub workflow inputs, and production endpoints
- [x] All validation checks pass
  - [x] Azure CLI is authenticated to the confirmed production subscription
  - [x] Existing production resource group and both App Services are running
  - [x] GitHub production workflow exists and accepts branch refs
  - [x] Workflow-equivalent install, Prisma generation, typecheck, test, and build pass
  - [x] Prisma schema change is additive and production workflow refuses destructive changes
  - [x] Web and API Dockerfiles are present and production workflow builds both images
  - [x] Production API health endpoint responds successfully before deployment
  - [x] Existing-resource update requires no new Azure quota
- [x] Update status to `Validated`
- [x] Record validation proof below

### Phase 4: Deployment
- [x] Invoke azure-deploy
- [x] Dispatch `deploy-prod-containers.yml` for `all`
- [x] Run database reconciliation; forced additive migration after detecting the workflow's branch-SHA auto-detection issue
- [x] Verify API health and web endpoint
- [x] Update status to `Deployed`

---

## 8. Validation Proof

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|
| Production workflow-equivalent validation | `npm ci --ignore-scripts && npm run db:generate && npm run typecheck && npm run test && npm run build` | ✅ Pass | 2026-09-21T15:12:00+03:00 |
| Azure context and resources | `az account set ... && az group show ... && az webapp show ...` | ✅ Correct subscription; resource group and both apps running | 2026-09-21T15:08:00+03:00 |
| Schema safety | `git diff origin/main...HEAD -- packages/database/prisma/schema.prisma` | ✅ Three nullable additive columns only | 2026-09-21T15:32:00+03:00 |
| Release ref | `git ls-remote --heads origin shaiwinograd/refine-worker-home-owner-strip` | ✅ Commit `1d910f0` available remotely | 2026-09-21T15:32:00+03:00 |
| Deployment workflow | `gh workflow view deploy-prod-containers.yml --yaml` and recent run query | ✅ Workflow valid; five latest production runs successful | 2026-09-21T15:32:00+03:00 |
| Azure Policy | `az policy assignment list --scope .../resourceGroups/workforce-rg` | ✅ No blocking resource-group policy assignments | 2026-09-21T15:32:00+03:00 |
| Production baseline health | `curl` API health and web endpoint | ✅ API `status: ok`; web HTTP 200 | 2026-09-21T15:32:00+03:00 |

**Validated by:** azure-validate skill
**Validation timestamp:** 2026-09-21T15:33:00+03:00

### Deployment Proof

| Check | Result |
|-------|--------|
| Full web + API deployment | ✅ https://github.com/ShaiWinograd/sao-app/actions/runs/35600212503 |
| Forced additive schema reconciliation + API redeploy | ✅ https://github.com/ShaiWinograd/sao-app/actions/runs/35600703424 |
| Prisma schema reconciliation | ✅ `prisma db push` completed and zero drift remained |
| API health after migration | ✅ `{"status":"ok"}` |
| Production web after deployment | ✅ HTTP 200 |
| Follow-up workflow correction | ✅ Deployment SHA now comes from the checked-out ref rather than the workflow definition ref |

---

## 9. Files

| File | Purpose | Status |
|------|---------|--------|
| `.azure/deployment-plan.md` | Deployment source of truth | ✅ |
| `.github/workflows/deploy-prod-containers.yml` | Existing production deployment workflow | ✅ Existing |
| `apps/web/Dockerfile` | Web production image | ✅ Existing |
| `packages/api/Dockerfile` | API production image | ✅ Existing |

---

## 10. Deployment Endpoints

- Web: https://spaceorder-web-app-poc2.azurewebsites.net
- API health: https://spaceorder-api-app-poc-h7hef6a2gtd5euhq.israelcentral-01.azurewebsites.net/health
