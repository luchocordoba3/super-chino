import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test('Mercado Pago: conectar, imprimir los QR y cobrar con el monto ya cargado', async ({ page }) => {
  await loginOwner(page);
  // El dueño pega su Access Token y crea los QR (con la dirección del local).
  await page.goto('/settings');
  // Sin "Conectar Mercado Pago" configurado, el campo del token ya está a la vista.
  await page.getByLabel('Access Token').fill('APP_USR-e2e-1234567890-token');
  await page.getByRole('button', { name: es.mp.connectToken }).click();
  await expect(page.getByText(es.mp.connected.replace('{{id}}', '777'))).toBeVisible();
  const setup = await page.request.post('/api/mp/setup', {
    data: { address: { streetName: 'San Martín', streetNumber: '1200', city: 'Rosario', state: 'Santa Fe', latitude: -32.95, longitude: -60.66 } },
  });
  expect(setup.ok()).toBe(true);
  await page.reload();
  await page.getByRole('link', { name: es.mp.printQrs.replace('{{count}}', '7') }).click();
  await expect(page.locator('.qr-card', { hasText: 'Mesa 3' }).getByRole('img', { name: es.qrs.pay })).toBeVisible();
  await expect(page.locator('.qr-card', { hasText: es.mp.counter })).toBeVisible();

  // En la caja: QR → se manda el monto al QR del mostrador y la venta se cierra sola cuando pagan.
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('0');
  await page.getByRole('button', { name: es.pos.openCash }).click();
  await page.locator('.pos-key', { hasText: 'Alfajor triple' }).click();
  await page.getByRole('button', { name: /Cobrar/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: es.pos.methods.QR, exact: true }).click();
  await page.getByRole('button', { name: `📱 ${es.mp.chargeAt.replace('{{where}}', es.mp.counter)}` }).click();
  await expect(page.getByText(es.mp.waiting.replace('{{where}}', es.mp.counter))).toBeVisible();
  await expect(page.getByText(es.pos.saleDone)).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => ((await (await page.request.get('/api/sales')).json()) as { payments: unknown[] }[])[0]?.payments)
    .toEqual([{ method: 'QR', amount: 1200, ref: expect.stringMatching(/^ORD\d+$/) }]);
});
