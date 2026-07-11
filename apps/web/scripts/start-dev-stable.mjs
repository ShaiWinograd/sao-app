#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
const DEFAULT_PORT = 3000;

const require = createRequire(import.meta.url);
const nextBinPath = require.resolve('next/dist/bin/next');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const shouldClean = !args.has('--skip-clean');
const port = process.env.PORT ?? String(DEFAULT_PORT);
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAssetUrl(assetPath) {
  if (!assetPath) return null;
  if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
    return assetPath;
  }
  if (assetPath.startsWith('/')) {
    return `${baseUrl}${assetPath}`;
  }
  return `${baseUrl}/${assetPath}`;
}

async function fetchUrl(url) {
  const response = await fetch(url, { redirect: 'manual' });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

function extractCssAssetPath(html) {
  const match = html.match(/href="([^"]*\/_next\/static\/css\/[^"]+\.css[^"]*)"/i);
  return match?.[1] ?? null;
}

async function waitForHealthyUi() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastFailure = 'שרת הפיתוח עדיין נטען';

  while (Date.now() < deadline) {
    try {
      const dashboard = await fetchUrl(`${baseUrl}/dashboard`);
      if (!dashboard.ok) {
        lastFailure = `/dashboard החזיר ${dashboard.status}`;
        await sleep(HEALTH_POLL_INTERVAL_MS);
        continue;
      }

      const cases = await fetchUrl(`${baseUrl}/cases`);
      if (!cases.ok) {
        lastFailure = `/cases החזיר ${cases.status}`;
        await sleep(HEALTH_POLL_INTERVAL_MS);
        continue;
      }

      const cssAssetPath = extractCssAssetPath(dashboard.body) ?? extractCssAssetPath(cases.body);
      if (!cssAssetPath) {
        lastFailure = 'לא נמצא קובץ CSS ב-HTML של האפליקציה';
        await sleep(HEALTH_POLL_INTERVAL_MS);
        continue;
      }

      const cssAssetUrl = normalizeAssetUrl(cssAssetPath);
      const cssResponse = await fetchUrl(cssAssetUrl);
      if (!cssResponse.ok) {
        lastFailure = `נכס CSS החזיר ${cssResponse.status}`;
        await sleep(HEALTH_POLL_INTERVAL_MS);
        continue;
      }

      return cssAssetUrl;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'שגיאה לא ידועה בבדיקת הבריאות';
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  throw new Error(`בדיקת יציבות ה-UI נכשלה: ${lastFailure}`);
}

if (shouldClean) {
  await rm(path.join(appDir, '.next'), { recursive: true, force: true });
}

const child = spawn(process.execPath, [nextBinPath, 'dev', '-p', port], {
  cwd: appDir,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

let shuttingDown = false;

function forwardSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child.pid) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (!shuttingDown && signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

try {
  const cssAssetUrl = await waitForHealthyUi();
  console.log(`\n✓ Web UI health checks passed: /dashboard, /cases, and CSS asset are all reachable (${cssAssetUrl})`);
} catch (error) {
  console.error(`\n✖ ${error instanceof Error ? error.message : 'Failed to verify web UI health'}`);
  forwardSignal('SIGTERM');
  process.exit(1);
}
