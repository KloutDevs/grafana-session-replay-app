#!/usr/bin/env node
// Takes the catalog screenshots from the test stack (npm run server + npm run fixtures:push), which
// holds synthetic sessions only. Output: src/img/screenshots/{sessions,replay}.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.GRAFANA_URL ?? 'http://127.0.0.1:13000';
const out = join(import.meta.dirname, '..', 'src', 'img', 'screenshots');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // The test stack's admin; basic auth avoids the first-login password screen.
  extraHTTPHeaders: { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}` },
});
const page = await context.newPage();

const plugin = `${base}/a/escalia-sessionreplay-app`;
await page.goto(`${plugin}/sessions?lookback=7d`);
await page.getByRole('row').filter({ hasText: 'W3zzC4gSP8' }).waitFor();
await page.screenshot({ path: join(out, 'sessions.png') });

await page.goto(`${plugin}/session/W3zzC4gSP8?t=17743`);
await page.getByTestId('replay-time').waitFor();
await page.frameLocator('[data-testid="replay-stage"] iframe').locator('body').waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'replay.png') });
await browser.close();
console.log('screenshots written to', out);
