import { expect, test } from '@playwright/test';

// A Viewer must not be able to browse recordings (they can show personal data).
const GRAFANA = process.env.GRAFANA_URL ?? 'http://127.0.0.1:13000';
const ADMIN = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

test('a Viewer is told they have no access and no Loki query is made', async ({ browser }) => {
  const login = `viewer${Date.now()}`;
  const created = await fetch(`${GRAFANA}/api/admin/users`, {
    method: 'POST',
    headers: { Authorization: ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer', login, email: `${login}@example.com`, password: 'viewer-password-1' }),
  });
  expect(created.ok).toBe(true);

  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const queries: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/ds/query')) {
      queries.push(request.url());
    }
  });
  await page.goto(`${GRAFANA}/login`);
  await page.fill('input[name="user"]', login);
  await page.fill('input[name="password"]', 'viewer-password-1');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.goto(`${GRAFANA}/a/escalia-sessionreplay-app/session/W3zzC4gSP8?t=1000`);
  await expect(page.getByText('You do not have access to session replays')).toBeVisible();
  expect(queries).toEqual([]);
  await context.close();
});
