import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { zh } from '../src/i18n/zh';
import { loginOwner, PURE, stockOf } from './helpers';

test('caja: vincular PC, cobrar y seguir vendiendo sin internet', async ({ page, context }) => {
  await loginOwner(page);
  await expect(page.getByText(zh.home.hello.replace('{{name}}', 'Li Wei'))).toBeVisible(); // el dueño usa la app en chino
  const before = await stockOf(page, PURE);

  await page.goto('/pos');
  await page.getByRole('button', { name: zh.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();

  // Sofía usa la caja en español.
  await page.getByLabel(es.pos.openingAmount).fill('5000');
  await page.getByRole('button', { name: es.pos.openCash }).click();

  const scan = page.getByPlaceholder(es.pos.scanHere);
  await scan.fill(`2*${PURE}`);
  await scan.press('Enter');
  await expect(page.getByText('Puré de tomate 520g')).toBeVisible();
  await page.keyboard.press('F12');
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await expect(page.getByText(es.pos.saleDone)).toBeVisible();
  await page.getByRole('button', { name: es.pos.newSale }).click();
  await expect.poll(() => stockOf(page, PURE)).toBe(before - 2);

  // Sin internet: la venta queda guardada en la PC y se envía al volver la conexión.
  await context.setOffline(true);
  await scan.fill(PURE);
  await scan.press('Enter');
  await expect(page.getByText('Puré de tomate 520g')).toBeVisible();
  await page.keyboard.press('F12');
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await page.getByRole('button', { name: es.pos.newSale }).click();
  await expect(page.getByText(es.pos.pendingSync.replace('{{count}}', '1'))).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(es.pos.synced)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => stockOf(page, PURE)).toBe(before - 3);
});
