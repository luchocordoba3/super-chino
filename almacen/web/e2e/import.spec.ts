import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { ean13, loginOwner, watchProblems } from './helpers';

test('importar una planilla y después imprimir sus etiquetas con precio por kilo', async ({ page }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/products/import');
  const csv = `codigo;nombre;precio;costo;stock;rubro\n${ean13(500)};Harina 000 1kg;1.500;900;10;Almacén\n;Aceitunas 40g;500;300;;Almacén\n`;
  await page.locator('input[type=file]').setInputFiles({ name: 'productos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(page.getByRole('cell', { name: 'Harina 000 1kg' })).toBeVisible();
  await page.getByRole('button', { name: es.importer.import.replace('{{count}}', '2') }).click();
  await expect(page.getByText(es.importer.done.replace('{{created}}', '2').replace('{{updated}}', '0').replace('{{unchanged}}', '0'))).toBeVisible();

  await page.getByRole('link', { name: es.importer.printLabels }).click();
  const harina = page.locator('.shelf-label', { hasText: 'Harina 000 1kg' });
  await expect(harina).toContainText(es.labels.per.kg);
  await expect(harina.locator('svg.sl-barcode')).toBeVisible();
  // Envase de 50 g o menos: el precio se informa cada 10 g.
  await expect(page.locator('.shelf-label', { hasText: 'Aceitunas 40g' })).toContainText(es.labels.per.g10);
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByRole('button', { name: es.labels.print }).click();
  expect(problems).toEqual([]);
});
