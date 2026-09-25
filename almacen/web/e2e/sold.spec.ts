import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test('qué se vendió: por turno, por día y la semana bajada a Excel', async ({ page }) => {
  await loginOwner(page);
  // El panel muestra el turno de hoy y lleva al detalle.
  await page.getByRole('link', { name: new RegExp(es.dashboard.shiftsToday) }).click();
  await expect(page.getByRole('heading', { name: es.sold.title })).toBeVisible();

  // Por turno: la caja que abrió Sofía hoy.
  const table = page.locator('table.units-table');
  await expect(table.locator('thead th', { hasText: 'Sofía' }).first()).toBeVisible();
  await expect(table.locator('tfoot')).toContainText(es.sold.tickets);

  // Por día: una columna por empleado.
  await page.getByRole('button', { name: es.sold.byDay }).click();
  await expect(table.locator('thead th').nth(1)).toBeVisible();

  // Por semana: 7 días + total, y se baja a Excel.
  await page.getByRole('button', { name: es.sold.byWeek }).click();
  await expect(table.locator('thead th')).toHaveCount(9);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: new RegExp(es.sold.excel) }).click();
  expect((await download).suggestedFilename()).toMatch(/^vendido-semana-\d{4}-\d{2}-\d{2}\.csv$/);
});
