import { expect, test } from '@playwright/test';
import { zh } from '../src/i18n/zh';
import { loginOwner, stockOf } from './helpers';

test('carga rápida: escanear código nuevo, nombre, precio y cantidad', async ({ page }) => {
  await loginOwner(page);
  await page.goto('/stock');
  const code = page.getByPlaceholder(zh.products.barcode);
  await code.fill('7799999999994');
  await code.press('Enter');
  await page.getByLabel(zh.common.name).fill('Puré de tomate casero');
  await page.getByLabel(`${zh.common.price} ($)`).fill('1500');
  await page.getByLabel(zh.common.qty).fill('12');
  await page.getByRole('button', { name: zh.stock.saveEntry }).click();
  await expect(page.getByText('✓ Puré de tomate casero')).toBeVisible();
  expect(await stockOf(page, '7799999999994')).toBe(12);
});

test('cambiar un precio y verlo en el historial', async ({ page }) => {
  await loginOwner(page);
  await page.goto('/products');
  await page.getByPlaceholder(zh.products.searchPlaceholder).fill('Yerba');
  await page.getByRole('link', { name: 'Yerba mate 1kg' }).click();
  const price = page.getByLabel(`${zh.common.price} ($)`);
  await price.fill('4990');
  await page.getByRole('button', { name: zh.common.save }).first().click();
  await expect(page.getByText('$ 4.500,00 → $ 4.990,00')).toBeVisible();
});
