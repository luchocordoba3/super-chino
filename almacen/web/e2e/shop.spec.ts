import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test('pedidos por WhatsApp: el cliente pide con el link y la caja lo cobra', async ({ page, browser }) => {
  await loginOwner(page);
  await page.goto('/settings');
  await expect(page.getByLabel(es.shop.link)).toHaveValue(/\/p\/demo$/);

  // El cliente, desde el celular.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guest = await phone.newPage();
  await guest.goto('/p/demo');
  await expect(guest.getByText('Envíos en el barrio de 9 a 21 hs')).toBeVisible();
  await guest.getByPlaceholder(es.common.search).fill('yerba');
  await guest.getByRole('button', { name: `${es.menu.add} Yerba mate 1kg` }).click();
  await guest.getByRole('button', { name: '+ Yerba mate 1kg' }).click();
  await guest.getByRole('button', { name: es.shop.continue }).click();
  await guest.getByLabel(es.shop.name).fill('Pedro');
  await guest.getByLabel(es.shop.phone).fill('341 555-1234');
  await guest.getByRole('button', { name: new RegExp(es.shop.pickup) }).click();
  await guest.getByRole('button', { name: es.shop.place }).click();
  await expect(guest.getByText(es.shop.doneTitle.replace('{{number}}', '2'))).toBeVisible();
  const wa = await guest.getByRole('link', { name: new RegExp(es.shop.sendWhatsapp) }).getAttribute('href');
  expect(decodeURIComponent(wa!)).toContain('https://wa.me/5491100000000?text=Hola! Soy Pedro. Te hago el pedido N° 2:\n• 2 × Yerba mate 1kg');
  await phone.close();

  // En la caja: aparece en Pedidos, se cobra y queda entregado.
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('0');
  await page.getByRole('button', { name: es.pos.openCash }).click();
  await page.getByRole('button', { name: new RegExp(es.orders.title) }).click();
  const card = page.getByRole('dialog').locator('.order', { hasText: 'N° 2 · Pedro' });
  await expect(card).toContainText('2 × Yerba mate 1kg');
  await card.getByRole('button', { name: es.orders.charge }).click();
  await expect(page.locator('.pos-right')).toContainText(es.orders.charging.replace('{{number}}', '2').replace('{{name}}', 'Pedro'));
  await expect(page.locator('.pos-total')).toHaveText('$ 9.000,00');
  await page.keyboard.press('F12');
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await expect(page.getByText(es.pos.saleDone)).toBeVisible();
  await expect
    .poll(async () => ((await (await page.request.get('/api/orders')).json()) as { number: number; status: string }[]).find((o) => o.number === 2)?.status)
    .toBe('DELIVERED');
});
