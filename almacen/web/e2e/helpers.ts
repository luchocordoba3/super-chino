import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { es } from '../src/i18n/es';

/** Mismo cálculo que el seed: códigos EAN-13 de los productos de demostración. */
export function ean13(n: number) {
  const base = `779${String(n).padStart(9, '0')}`;
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}
export const PURE = ean13(1);
export const YOGUR = ean13(10);

export async function loginOwner(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: es.login.owner, exact: true }).click();
  await page.getByLabel(es.login.email).fill('dueno@demo.com');
  await page.getByLabel(es.login.password).fill('demo1234');
  await page.getByRole('button', { name: es.login.enter, exact: true }).click();
  // Esperar a que cargue la sesión del dueño.
  await expect(page.getByRole('button', { name: es.common.logout })).toBeVisible();
}

export async function stockOf(page: Page, barcode: string) {
  const res = await page.request.get(`/api/products/barcode/${barcode}`);
  return (await res.json()).product.stock as number;
}

export async function loginEmployee(page: Page, username: string, pin: string) {
  await page.goto('/');
  await page.getByRole('button', { name: es.login.employee, exact: true }).click();
  await page.getByLabel(es.login.storeCode).fill('DEMO01');
  await page.getByLabel(es.login.username).fill(username);
  await page.getByLabel(es.login.pin).fill(pin);
  await page.getByRole('button', { name: es.login.enter, exact: true }).click();
  await expect(page.getByRole('button', { name: es.common.logout })).toBeVisible();
}

/** Junta errores de la página: JavaScript, consola y respuestas de la API con error. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`JS: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) problems.push(`consola: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

/** PNG de 1x1 para probar fotos. */
export const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
