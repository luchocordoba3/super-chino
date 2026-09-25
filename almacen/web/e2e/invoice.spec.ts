import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

// Certificado de prueba (autofirmado, solo para estas pruebas; ARCA es un servidor falso).
const file = (name: string, mimeType: string) => ({ name, mimeType, buffer: readFileSync(`e2e/fixtures/${name}`) });

test('factura electrónica: datos de ARCA, factura C a pedido del cliente y el link para mandarla', async ({ page }) => {
  await loginOwner(page);
  await page.goto('/settings');
  const card = page.locator('.card', { hasText: es.invoice.settingsTitle });
  await card.getByLabel('CUIT').fill('20123456786');
  await card.getByLabel(es.invoice.businessName).fill('Carlos Pérez');
  await card.getByLabel(es.invoice.address).fill('Mitre 123, Rosario');
  await card.getByLabel(es.invoice.pointOfSale).fill('1');
  await card.getByLabel(es.invoice.certificate).setInputFiles(file('arca-test.crt', 'application/x-x509-ca-cert'));
  await card.getByLabel(es.invoice.key).setInputFiles(file('arca-test.key', 'application/octet-stream'));
  await card.getByRole('button', { name: es.invoice.saveFiscal }).click();
  await expect(page.getByText(es.common.saved)).toBeVisible();
  await card.getByRole('button', { name: es.invoice.test }).click();
  await expect(card.getByText(es.invoice.testOk.replace('{{last}}', 'C: 0'))).toBeVisible();

  // En la caja: se cobra y, como el cliente la pide, se factura.
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('0');
  await page.getByRole('button', { name: es.pos.openCash }).click();
  await page.locator('.pos-key', { hasText: 'Alfajor triple' }).click();
  await page.keyboard.press('F12');
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(es.invoice.button) }).click();
  await page.getByRole('button', { name: new RegExp(es.invoice.request) }).click();
  await expect(page.getByText(es.invoice.done.replace('{{letter}}', 'C').replace('{{code}}', '0001-00000001'))).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole('link', { name: new RegExp(es.invoice.open) }).getAttribute('href');

  // La factura que recibe el cliente, con el QR de ARCA.
  await page.goto(href!);
  await expect(page.getByText('FACTURA')).toBeVisible();
  await expect(page.getByText('N° 0001-00000001')).toBeVisible();
  await expect(page.getByText('CAE:', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR ARCA' })).toBeVisible();
  await expect(page.locator('.invoice')).toContainText('Alfajor triple');
});
