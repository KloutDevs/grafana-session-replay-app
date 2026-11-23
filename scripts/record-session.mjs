// Records one browsing session of a Faro-instrumented web app (running with replay on) so there is real
// data to replay. Needs the frontend served at FRONTEND_URL with VITE_FARO_URL pointing at the Alloy
// of the environment (see README, "Use it in a separate environment").
import { chromium } from '@playwright/test';
const base = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const go = (page, path) =>
  page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let faro = 0;
page.on('request', (r) => {
  if (r.url().includes('/collect')) {
    faro += 1;
  }
});
await page.goto(`${base}/terms`, { waitUntil: 'load' });
for (let i = 0; i < 8; i += 1) {
  await page.mouse.move(100 + i * 90, 150 + i * 40, { steps: 6 });
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(2500);
}
await page.evaluate(() =>
  setTimeout(() => {
    throw new TypeError("Cannot read properties of undefined (reading 'planId')");
  }, 0)
);
await page.waitForTimeout(3000);
await go(page, '/privacy');
for (let i = 0; i < 5; i += 1) {
  await page.mouse.move(200 + i * 100, 200 + i * 30, { steps: 5 });
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(2500);
}
await go(page, '/auth/sign-in');
await page.waitForTimeout(6000);
await go(page, '/terms');
for (let i = 0; i < 5; i += 1) {
  await page.mouse.move(300 + i * 80, 250 + i * 20, { steps: 5 });
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(8000);
console.log('faro requests', faro);
await browser.close();
