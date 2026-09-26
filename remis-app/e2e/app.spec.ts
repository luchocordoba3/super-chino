import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Ningún error de JavaScript en la página durante las pruebas.
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('un día de trabajo completo, con copia de seguridad', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-12T10:00:00-03:00'));
  await page.goto('/');

  // Primera vez
  await page.getByLabel('Marca y modelo').fill('Toyota Etios');
  await page.getByLabel('Patente').fill('aa 111 bb');
  await page.getByLabel('Km que marca hoy').fill('150000');
  await page.getByLabel('Lo comparto con otro chofer').check();
  await page.getByLabel('A los km').fill('141000');
  await page.getByRole('radio', { name: 'Porcentaje' }).click();
  await page.getByLabel('Porcentaje de lo recaudado').fill('20');
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();

  await expect(page.locator('.hero')).toHaveText('150.000 km');
  await expect(page.getByText('Se acerca: Aceite y filtro de aceite')).toBeVisible();
  await expect(page.getByText('faltan 1.000 km')).toBeVisible();

  // Empieza el turno recibiendo el auto con medio tanque
  await page.getByRole('button', { name: 'Empezar turno' }).click();
  await expect(page.getByLabel('Km del odómetro')).toHaveValue('150.000');
  await page.getByRole('radio', { name: '½' }).click();
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page.getByText('Turno en curso')).toBeVisible();

  // Carga de GNC
  await page.getByRole('button', { name: 'Combustible' }).click();
  await page.getByLabel('m³').fill('12,5');
  await page.getByLabel('Total pagado').fill('9875');
  await expect(page.getByText('Precio: $ 790 por m³')).toBeVisible();
  await page.getByLabel('Km del odómetro').fill('150120');
  await page.getByLabel('Estación').fill('GNC Centro');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('GNC: $ 9.875 anotado')).toBeVisible();

  // Peaje nuevo que queda guardado como favorito, y después de un toque
  await page.getByRole('button', { name: 'Peaje' }).click();
  await page.getByLabel('Monto').fill('1800');
  await page.getByLabel('Dónde').fill('Autopista');
  await page.getByLabel('Guardarlo en mis peajes').check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Peaje' }).click();
  await page.getByRole('button', { name: /Autopista/ }).click();
  await expect(page.getByText('Peaje $ 1.800 anotado')).toBeVisible();

  // Termina el turno con lo recaudado
  await page.getByRole('button', { name: 'Terminar turno' }).click();
  await page.getByLabel('Km del odómetro').fill('150250');
  await expect(page.getByText('Hiciste 250 km en este turno.')).toBeVisible();
  await page.getByLabel('Recaudado en viajes').fill('120000');
  await expect(page.getByText('La agencia se lleva $ 24.000 (20%).')).toBeVisible();
  await page.getByLabel('Viajes', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Terminar', exact: true }).click();
  await expect(page.getByText('Turno terminado: 250 km')).toBeVisible();

  const stat = (label: string) => page.locator('.stat', { hasText: label }).locator('.v');
  await expect(stat('Km hoy')).toHaveText('250 km');
  await expect(stat('Recaudado')).toHaveText('$ 120.000');
  await expect(stat('Gastos')).toHaveText('$ 13.475');
  await expect(stat('Ganancia')).toHaveText('$ 82.525');
  await expect(page.getByText('faltan 750 km')).toBeVisible();

  // Movimientos
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByText('Turno · 250 km')).toBeVisible();
  await expect(page.getByText('GNC · 12,5 m³')).toBeVisible();

  // Service: el aviso del aceite se va
  await page.getByRole('link', { name: 'Auto' }).click();
  await page.getByRole('button', { name: 'Registrar service' }).click();
  await page.getByRole('checkbox', { name: 'Aceite y filtro de aceite' }).check();
  await page.getByLabel('Cuánto pagaste').fill('60000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.item', { hasText: 'Aceite y filtro de aceite' }).locator('.badge')).toHaveText('Al día');

  // Resumen de la semana
  await page.getByRole('link', { name: 'Resumen' }).click();
  await expect(page.locator('.hero')).toHaveText('$ 22.525');
  await expect(page.getByText('Rinde', { exact: false })).toHaveCount(0);

  // Copia de seguridad: descargar, borrar todo y restaurar
  await page.getByRole('link', { name: 'Ajustes' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar' }).click()]);
  expect(dl.suggestedFilename()).toBe('mi-remis-copia-2026-05-12.json');
  const file = test.info().outputPath('copia.json');
  await dl.saveAs(file);
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await expect(page.getByRole('button', { name: 'Empezar', exact: true })).toBeVisible();
  // El archivo va como contenido: Chromium no adjunta rutas con acentos (como la carpeta de esta prueba).
  await page.getByTestId('restore-onb').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.getByText('Copia restaurada')).toBeVisible();
  await page.getByRole('link', { name: 'Hoy' }).click();
  await expect(page.locator('.topkm strong')).toHaveText('150.250 km');
  await expect(stat('Recaudado')).toHaveText('$ 120.000');
});

test('los datos de ejemplo muestran avisos y el gráfico', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Primero quiero verla con datos de ejemplo').click();
  await expect(page.getByText('Venció: Oblea de GNC')).toBeVisible();
  await expect(page.getByText(/Rinde menos el GNC/)).toBeVisible();
  await page.getByRole('link', { name: 'Resumen' }).click();
  await expect(page.getByRole('img', { name: 'Km por día' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver como tabla' }).click();
  await expect(page.getByRole('columnheader', { name: 'Otro chofer' })).toBeVisible();
});

test('abre sin internet después de la primera vez', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mi Remis' })).toBeVisible();
  await context.setOffline(false);
});
