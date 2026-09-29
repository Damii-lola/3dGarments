import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch();
for (const f of ['MaleModel', 'FemaleModel']) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto(`http://127.0.0.1:5174/extract.html?f=${f}`);
  await page.waitForFunction(() => window.__out, null, { timeout: 180000 });
  const d = await page.evaluate(() => JSON.stringify(window.__out));
  writeFileSync(`/home/user/3dGarments/tools/body/out/${f}.json`, d);
  console.log(f, d.length);
  await page.close();
}
await browser.close();
