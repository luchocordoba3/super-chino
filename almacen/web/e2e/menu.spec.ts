import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test('menú QR: el cliente pide desde la mesa, la caja acepta y el cliente pide la cuenta', async ({ page, browser }) => {
  await loginOwner(page);
  const tables = (await (await page.request.get('/api/menu/tables')).json()) as { table: number; path: string }[];
  const path = tables.find((t) => t.table === 4)!.path;

  // El cartel de la mesa trae el QR de la carta.
  await page.goto('/qrs');
  await expect(page.locator('.qr-card', { hasText: 'Mesa 4' }).getByRole('img', { name: es.qrs.menu })).toBeVisible();

  // El cliente, desde su celular y sin cuenta.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guest = await phone.newPage();
  await guest.goto(path);
  await expect(guest.getByText(es.menu.table.replace('{{n}}', '4'))).toBeVisible();
  await guest.getByRole('button', { name: `${es.menu.add} Fernet con coca` }).click();
  await guest.getByRole('button', { name: '+ Fernet con coca' }).click();
  await guest.getByRole('button', { name: `${es.menu.add} Papas fritas 150g` }).click();
  await expect(guest.locator('.menu-cartbar')).toContainText('$ 12.800,00');
  await guest.getByRole('button', { name: es.menu.order, exact: true }).click();
  await expect(guest.getByText(es.menu.sent)).toBeVisible();
  await expect(guest.getByText(es.menu.pending).first()).toBeVisible();

  // En la caja aparece la mesa 4 con lo que pidieron para aceptar.
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('0');
  await page.getByRole('button', { name: es.pos.openCash }).click();
  await page.locator('.pos-tickets').getByRole('button', { name: /Mesa 4/ }).click();
  await expect(page.locator('.tab-pending')).toContainText('Fernet con coca');
  await page.getByRole('button', { name: es.tabs.acceptAll }).click();
  await expect(page.locator('.tab-pending')).toHaveCount(0);
  await expect(page.locator('.pos-total')).toHaveText('$ 12.800,00');

  // El cliente ve su cuenta confirmada y pide la cuenta; la caja lo ve.
  await expect.poll(async () => (await guest.reload(), await guest.getByText(es.menu.pending).count()), { timeout: 20_000 }).toBe(0);
  await guest.getByRole('button', { name: new RegExp(es.menu.askBill) }).click();
  await expect(guest.getByText(es.menu.billSent)).toBeVisible();
  await expect(page.locator('.pos-tickets button', { hasText: 'Mesa 4' })).toContainText('🧾', { timeout: 20_000 });
  await phone.close();
});
