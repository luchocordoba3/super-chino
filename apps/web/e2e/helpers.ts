import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { es } from '../src/i18n/es';
import { zh } from '../src/i18n/zh';

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
  // El dueño de la demo usa la app en chino: esperar a que cargue su sesión.
  await expect(page.getByRole('button', { name: zh.common.logout })).toBeVisible();
}

export async function stockOf(page: Page, barcode: string) {
  const res = await page.request.get(`/api/products/barcode/${barcode}`);
  return (await res.json()).product.stock as number;
}
