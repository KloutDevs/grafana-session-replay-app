import { expect, test } from './fixtures';

// Sessions from tests/synthetic (or local tests/fixtures). W3zzC4gSP8 lasts 39 s and has one exception at 20.9 s.
const SESSION = 'W3zzC4gSP8';

test.describe('sessions list', () => {
  test('lists the recorded sessions with their error counts', async ({ gotoPage, page }) => {
    await gotoPage('/sessions?lookback=7d');
    const row = page.getByRole('row').filter({ hasText: SESSION });
    await expect(row).toBeVisible();
    await expect(row).toContainText('quickaction-dashboard-frontend');
    await expect(row.getByText('1', { exact: true }).last()).toBeVisible();
  });

  test('filters by free text and keeps the filter in the URL', async ({ gotoPage, page }) => {
    await gotoPage('/sessions?lookback=7d');
    await page.getByPlaceholder('Search session, user or browser').fill('UH8CtirMwV');
    await expect(page.getByRole('row').filter({ hasText: SESSION })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'UH8CtirMwV' })).toBeVisible();
    expect(page.url()).toContain('q=UH8CtirMwV');
  });
});

test.describe('replay', () => {
  test('opens a session at the moment of a link and shows the recorded page', async ({ gotoPage, page }) => {
    await gotoPage(`/session/${SESSION}?t=17743`);
    await expect(page.getByTestId('replay-time')).toContainText('0:17 / 0:39');
    const frame = page.frameLocator('[data-testid="replay-stage"] iframe');
    await expect(frame.locator('body')).not.toBeEmpty();
    await expect(page.getByText('RangeError: JUMP_TEST2 mid error')).toBeVisible();
  });

  test('jumps to an event of the journey a few seconds before it', async ({ gotoPage, page }) => {
    await gotoPage(`/session/${SESSION}`);
    await expect(page.getByTestId('replay-time')).toContainText('0:00 / 0:39');
    await page.getByRole('listitem').filter({ hasText: 'RangeError' }).getByRole('button').click();
    await expect(page.getByTestId('replay-time')).toContainText('0:17 / 0:39');
  });

  test('plays, pauses and seeks from the timeline', async ({ gotoPage, page }) => {
    await gotoPage(`/session/${SESSION}`);
    await expect(page.getByTestId('replay-time')).toContainText('0:00 / 0:39');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('slider', { name: 'Position in the recording' }).press('ArrowRight');
    await expect(page.getByTestId('replay-time')).not.toContainText('0:00 / 0:39');
  });

  test('tells about a session that has no data', async ({ gotoPage, page }) => {
    await gotoPage('/session/doesNotExist1');
    await expect(page.getByText('No recording found for this session')).toBeVisible();
  });

  test('refuses an id that is not safe to put in a query', async ({ gotoPage, page }) => {
    await gotoPage('/session/a%22%7D%20or%20%7Bx%3D%22y');
    await expect(page.getByText('This is not a valid session id')).toBeVisible();
  });

  test('asks nothing of any host but Grafana from the plugin page itself', async ({ gotoPage, page }) => {
    const origin = new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:13000' : page.url()).origin;
    const foreign: string[] = [];
    page.on('request', (request) => {
      // Requests of the replayed page (its own iframe) are the recorded application's assets.
      if (
        request.frame() === page.mainFrame() &&
        !request.url().startsWith(origin) &&
        !/^(data|blob):/.test(request.url())
      ) {
        foreign.push(request.url());
      }
    });
    await gotoPage(`/session/${SESSION}?t=5000`);
    await expect(page.getByTestId('replay-time')).toContainText('/ 0:39');
    expect(foreign).toEqual([]);
  });
});
