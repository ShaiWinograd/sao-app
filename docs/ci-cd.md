# CI/CD and Release Setup

## What is configured

- CI pipeline for typecheck, unit tests, and build.
- Web E2E smoke tests with Playwright.
- Semantic release notes and version bumps using release-please.
- Separate deployment workflows for development and production environments.

## Workflows

- CI: .github/workflows/ci.yml
- Release: .github/workflows/release.yml
- Dev deploy: .github/workflows/deploy-dev.yml
- Prod deploy: .github/workflows/deploy-prod.yml

## Required repository configuration

### Variables

- E2E_BASE_URL: URL used by Playwright smoke tests (for example, dev web URL).

### Secrets

- DEPLOY_DEV_COMMAND: Shell command to deploy to development.
- DEPLOY_PROD_COMMAND: Shell command to deploy to production.

Examples:

- DEPLOY_DEV_COMMAND: az webapp up --name spaceorder-web-dev --resource-group rg-spaceorder-dev --runtime "NODE:20-lts"
- DEPLOY_PROD_COMMAND: az webapp up --name spaceorder-web-prod --resource-group rg-spaceorder-prod --runtime "NODE:20-lts"

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

## Running tests locally

- Unit tests: npm run test
- Web E2E: npm run -w @workforce/web e2e

To run E2E against deployed environment:

- E2E_BASE_URL=https://your-dev-url npm run -w @workforce/web e2e
