# Azure Deployment Plan

> **Status:** Approved

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
- [ ] Commit the validated application changes
- [ ] Integrate the latest `origin/main` without conflicts
- [ ] Push the deployment branch
- [ ] Verify GitHub production workflow configuration
- [ ] Update status to `Ready for Validation`

### Phase 3: Validation
- [ ] Invoke azure-validate workflow
- [ ] Validate repository, images, schema change, GitHub workflow inputs, and production endpoints
- [ ] Update status to `Validated`
- [ ] Record validation proof below

### Phase 4: Deployment
- [ ] Invoke azure-deploy
- [ ] Dispatch `deploy-prod-containers.yml` for `all`
- [ ] Run database reconciliation with `run_migration=auto`
- [ ] Verify API health and web endpoint
- [ ] Update status to `Deployed`

---

## 8. Validation Proof

Pending azure-validate.

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
