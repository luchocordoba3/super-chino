import { expect, test } from '@playwright/test';
import { zh } from '../src/i18n/zh';
import { loginOwner } from './helpers';

test('lote por vencer: la revisión sugiere oferta y el dueño la aprueba', async ({ page }) => {
  await loginOwner(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: zh.settings.runJobs }).click();
  await expect(page.getByText(zh.settings.jobsDone)).toBeVisible();

  await page.goto('/offers');
  const card = page.locator('.card', { hasText: 'Yogur bebible frutilla 1L' });
  await expect(card.getByText('-35%')).toBeVisible();
  await card.getByRole('button', { name: zh.offers.approve }).click();
  await expect(page.getByRole('heading', { name: zh.offers.active })).toBeVisible();

  // Los avisos se muestran en el idioma del dueño.
  await page.goto('/alerts');
  await expect(page.getByText(/批次已于/)).toBeVisible();
});
