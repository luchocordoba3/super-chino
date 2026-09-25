import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test('stock en %: ver qué se está terminando y cargar un stock ideal', async ({ page }) => {
  await loginOwner(page);
  await page.getByRole('link', { name: es.nav.levels }).click();
  await expect(page.getByRole('heading', { name: es.levels.title })).toBeVisible();

  const row = page.locator('.list-item', { hasText: 'Vino tinto 750ml' });
  await expect(row.getByRole('meter')).toBeVisible();
  await expect(row.getByText(es.levels.auto)).toBeVisible();

  // Con un stock ideal alto, el vino pasa a estar bajo (rojo).
  await row.getByRole('button', { name: es.levels.setIdeal }).click();
  await row.getByLabel(es.levels.ideal).fill('200');
  await row.getByRole('button', { name: '✓' }).click();
  await expect(row.getByText(es.levels.manual)).toBeVisible();
  await expect(row.locator('.level-text-low')).toBeVisible();

  await page.getByLabel(/Solo bajos/).check();
  await expect(page.locator('.list-item', { hasText: 'Vino tinto 750ml' })).toBeVisible();
  await expect(page.locator('.level-text-ok')).toHaveCount(0);
});
