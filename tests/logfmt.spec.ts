import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import pluginJson from '../src/plugin.json';

// The same sessions, written the way the test stack of Alloy writes them (key=value lines).
// This file changes the plugin settings for its duration, so it runs after the JSON ones (one worker).
const GRAFANA = process.env.GRAFANA_URL ?? 'http://127.0.0.1:13000';
const LOKI = process.env.LOKI_URL ?? 'http://127.0.0.1:13100';
const AUTH = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
const SETTINGS_URL = `${GRAFANA}/api/plugins/${pluginJson.id}/settings`;

/** Loki can take a moment to serve a stream it has just received. */
async function waitForLokiLines(selector: string, expected: number) {
  const now = Date.now();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const url = new URL(`${LOKI}/loki/api/v1/query_range`);
    url.searchParams.set('query', `${selector} |= \`faro.session_recording.started\``);
    url.searchParams.set('start', `${(now - 7 * 86_400_000) * 1_000_000}`);
    url.searchParams.set('end', `${(now + 60_000) * 1_000_000}`);
    const body = (await (await fetch(url)).json()) as { data: { result: Array<{ values: unknown[] }> } };
    if (body.data.result.reduce((sum, stream) => sum + stream.values.length, 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Loki did not serve the pushed lines in time');
}

async function saveSettings(jsonData: Record<string, string>) {
  const response = await fetch(SETTINGS_URL, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, pinned: true, jsonData }),
  });
  expect(response.ok).toBe(true);
}

test.describe.serial('logfmt lines', () => {
  test.beforeAll(async () => {
    test.setTimeout(90_000);
    execFileSync('node', [join(__dirname, '..', 'scripts', 'push-fixtures.mjs'), LOKI, 'logfmt']);
    await waitForLokiLines('{source=~"faro|faro_replay"}', 4);
    await saveSettings({ lokiUid: 'loki', format: 'logfmt', selector: '{source=~"faro|faro_replay"}' });
  });

  test.afterAll(async () => {
    await saveSettings({ lokiUid: 'loki', format: 'json', selector: '{service_name="frontend"}' });
  });

  test('lists the sessions', async ({ gotoPage, page }) => {
    await gotoPage('/sessions?lookback=7d');
    await expect(page.getByRole('row').filter({ hasText: 'W3zzC4gSP8' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '2cd7jMwyMM' })).toBeVisible();
  });

  test('opens the same session at the same moment', async ({ gotoPage, page }) => {
    await gotoPage('/session/W3zzC4gSP8?t=17743');
    await expect(page.getByTestId('replay-time')).toContainText('0:17 / 0:39');
    await expect(page.frameLocator('[data-testid="replay-stage"] iframe').locator('body')).not.toBeEmpty();
    await expect(page.getByText('RangeError: JUMP_TEST2 mid error')).toBeVisible();
  });
});
