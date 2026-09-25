import { expect, type Page, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginEmployee, loginOwner, watchProblems } from './helpers';

// Recorre todas las pantallas buscando errores y (en celular) desbordes horizontales.
async function visit(page: Page, routes: string[], errorText: string, checkOverflow: boolean) {
  const found: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    if (await page.getByText(errorText).count()) found.push(`${route}: muestra un error en pantalla`);
    if (checkOverflow) {
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (extra > 1) found.push(`${route}: se sale ${extra}px de ancho`);
    }
  }
  return found;
}

const OWNER = ['/', '/stock', '/products', '/products/import', '/labels', '/suppliers', '/messages', '/alerts', '/offers', '/offers/print', '/reorder', '/sales', '/team', '/attendance', '/settings', '/stock/scan'];

test('dueño en el celular: todas las pantallas sin errores', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const problems = watchProblems(page);
  await loginOwner(page);
  const found = await visit(page, OWNER, es.common.error, true);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: es.settings.resetDemo })).toBeVisible();
  await page.goto('/products');
  await page.locator('tbody tr').first().click();
  await expect(page.getByRole('heading', { name: es.products.priceHistory })).toBeVisible();
  expect([...found, ...problems]).toEqual([]);
});

test('empleada en la PC (español): sus pantallas sin errores', async ({ page }) => {
  const problems = watchProblems(page);
  await loginEmployee(page, 'sofia', '1234');
  const found = await visit(page, ['/', '/stock', '/products', '/messages', '/reorder', '/settings'], es.common.error, false);
  expect([...found, ...problems]).toEqual([]);
});
