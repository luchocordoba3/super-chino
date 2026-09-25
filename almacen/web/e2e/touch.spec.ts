import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

async function openCash(page: import('@playwright/test').Page) {
  await loginOwner(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('5000');
  await page.getByRole('button', { name: es.pos.openCash }).click();
}

test.describe('caja táctil en tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('vender con botones rápidos por categoría', async ({ page }) => {
    await openCash(page);
    await page.locator('.pos-quick-cats').getByRole('button', { name: 'Kiosco' }).click();
    await expect(page.locator('.pos-key', { hasText: 'Cerveza lata' })).toHaveCount(0);
    const alfajor = page.locator('.pos-key', { hasText: 'Alfajor triple' });
    await alfajor.click();
    await alfajor.click();
    await expect(page.locator('.pos-right .pos-line', { hasText: 'Alfajor triple' })).toContainText('2 ×');
    await expect(page.locator('.pos-total')).toHaveText('$ 2.400,00');
    await page.getByRole('button', { name: new RegExp(es.pos.pay) }).click();
    await page.getByRole('button', { name: es.pos.confirmSale }).click();
    await expect(page.getByText(es.pos.saleDone)).toBeVisible();
  });
});

test.describe('caja en el celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('productos y cuenta en dos pestañas', async ({ page }) => {
    await openCash(page);
    await page.locator('.pos-key', { hasText: 'Gaseosa cola 500ml' }).click();
    // La cuenta no se ve hasta tocar su pestaña, que muestra cuántos productos y el total.
    await expect(page.locator('.pos-right')).toBeHidden();
    const cartTab = page.locator('.pos-mobile-bar').getByRole('button', { name: /Cuenta \(1\)/ });
    await expect(cartTab).toContainText('$ 1.500,00');
    await cartTab.click();
    await expect(page.locator('.pos-right .pos-line', { hasText: 'Gaseosa cola 500ml' })).toBeVisible();
    await expect(page.locator('.pos-quick')).toBeHidden();
  });
});
