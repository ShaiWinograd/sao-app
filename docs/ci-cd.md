# CI/CD and Release Setup

## What is configured

- CI pipeline for typecheck, unit tests, and build.
- Web E2E smoke tests with Playwright.
- Semantic release notes and version bumps using release-please.
- Separate deployment workflows for development and production environments.

## Workflows

- CI: .github/workflows/ci.yml
- PR governance: .github/workflows/pr-governance.yml
- Release: .github/workflows/release.yml
- Dev deploy: .github/workflows/deploy-dev.yml
- Prod deploy: .github/workflows/deploy-prod.yml

## Branch Strategy (No Direct Push To Main)

Use this flow for every code change:

1. Create a feature branch from `main`.
2. Open a Pull Request into `main`.
3. Wait for required checks to pass.
4. Merge PR.
5. Let release-please manage version and release notes.

Recommended branch protection for `main`:

- Require PR before merge: enabled
- Required checks: `quality`, `semantic-pr-title`
- Require conversation resolution: enabled
- Required approvals: `0` for solo mode, `1+` when team grows
- Include administrators: enabled

## Required repository configuration

### Variables

- E2E_BASE_URL: URL used by Playwright smoke tests (for example, dev web URL).

### Secrets

- DEPLOY_DEV_COMMAND: Shell command to deploy to development.
- AZURE_CREDENTIALS: Azure service principal JSON for GitHub Actions (`azure/login`).

Deployment workflows are intentionally strict:

- If the deploy command secret is missing, the workflow fails.
- A green deploy workflow should always mean a real deployment command was executed.
- Production deploy is manual (`workflow_dispatch`) and relies on the `production` environment approval gate.

Production is deployed directly to the current Azure App Services:

- Web: `spaceorder-web-app-poc2`
- API: `spaceorder-api-app-poc`
- Resource group: `workforce-rg`

Examples:

- DEPLOY_DEV_COMMAND: az webapp up --name spaceorder-web-dev --resource-group rg-spaceorder-dev --runtime "NODE:20-lts"
- AZURE_CREDENTIALS: `{"clientId":"...","clientSecret":"...","subscriptionId":"fdb353b1-3b56-4c72-bd66-fbbe625d8a96","tenantId":"2a5148b8-e427-4aec-ab2c-48bb34a125fd"}`

## Environments

Create two GitHub Environments and attach approvals/secrets:

- development
- production

Recommended policy:

- development: no manual approval, protected secrets.
- production: required reviewer approval + protected secrets.

## Solo Maintainer Mode (recommended for this repo now)

If you are the only contributor, keep PR workflow enabled but avoid review deadlocks:

- Keep: "Require a pull request before merging"
- Set: "Required approvals" to `0`
- Disable: "Require review from Code Owners"
- Keep: "Require status checks to pass" with `quality`
- Keep: "Require conversation resolution"

For environments in solo mode:

- development: no required reviewers
- production: no required reviewers (or disable self-review restriction if you add yourself)

When the team grows, switch back to:

- required approvals: `1+`
- code owner reviews: enabled
- production required reviewer(s): enabled

## Release model

The release workflow uses conventional commits on main:

- feat: minor bump
- fix: patch bump
- feat!: major bump (or BREAKING CHANGE in body)

On each merge to main:

1. release-please updates/creates a release PR with the next version and changelog.
2. Merging that release PR creates a GitHub Release and tag (vX.Y.Z).
3. Production deploy can run on release published event.

PR titles should follow semantic style (validated by workflow):

- `feat: ...`
- `fix: ...`
- `chore: ...`

This keeps release note generation consistent and predictable.

## Running tests locally

- Unit tests: npm run test
- Web E2E: npm run -w @workforce/web e2e

To run E2E against deployed environment:

- E2E_BASE_URL=https://your-dev-url npm run -w @workforce/web e2e
