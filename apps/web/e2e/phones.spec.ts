import { type Browser, expect, type Page, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { watchProblems } from './helpers';

// Casa de celulares (DEMO02): la misma app cambia sola según el rubro del local.
async function loginPhoneOwner(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: es.login.owner, exact: true }).click();
  await page.getByLabel(es.login.email).fill('celus@demo.com');
  await page.getByLabel(es.login.password).fill('demo1234');
  await page.getByRole('button', { name: es.login.enter, exact: true }).click();
  await expect(page.getByText('¡Hola, Nico!')).toBeVisible();
}
async function loginPhoneEmployee(browser: Browser, username: string, pin: string) {
  const page = await (await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' })).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: es.login.employee, exact: true }).click();
  await page.getByLabel(es.login.storeCode).fill('DEMO02');
  await page.getByLabel(es.login.username).fill(username);
  await page.getByLabel(es.login.pin).fill(pin);
  await page.getByRole('button', { name: es.login.enter, exact: true }).click();
  await expect(page.getByRole('button', { name: es.common.logout })).toBeVisible();
  return page;
}

test('caja de celulares: equipo por IMEI, pago en dólares y cuotas, cierre con cajón de dólares', async ({ page }) => {
  const problems = watchProblems(page);
  await loginPhoneOwner(page);
  const serials = (await (await page.request.get('/api/serials?status=AVAILABLE')).json()) as { id: string; imei1: string; product: string }[];
  const unit = serials[0];

  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Nico', exact: true }).click();
  for (const d of '0000') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('10000');
  await page.getByLabel('Dólares en la caja').fill('100');
  await page.getByRole('button', { name: es.pos.openCash }).click();

  const scan = page.getByPlaceholder(es.pos.scanHere);
  await scan.fill(unit.imei1);
  await scan.press('Enter');
  await expect(page.getByText(`IMEI ${unit.imei1}`)).toBeVisible();
  await page.getByRole('button', { name: 'Agregar cliente' }).click();
  await page.getByPlaceholder('Nombre y apellido').fill('Cliente E2E');
  await page.getByRole('button', { name: 'Usar este cliente' }).click();

  await page.keyboard.press('F12');
  await page.getByRole('button', { name: 'Efectivo US$' }).first().click();
  await page.getByLabel('Dólares recibidos').fill('100');
  await page.getByRole('button', { name: /Otro medio de pago/ }).click();
  await page.locator('.modal .card').nth(1).getByRole('button', { name: 'Crédito / cuotas' }).click();
  await page.locator('.modal select').last().selectOption({ label: '3 cuotas (3 cuotas, +15%)' });
  await expect(page.getByText(/Cobrar en la tarjeta/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar venta' }).click();
  await expect(page.getByText(es.pos.saleDone)).toBeVisible();
  await page.getByRole('button', { name: es.pos.newSale }).click();

  await expect.poll(async () => (await (await page.request.get(`/api/serials/${unit.id}`)).json()).status).toBe('SOLD');
  const sold = await (await page.request.get(`/api/serials/${unit.id}`)).json();
  expect(sold.customer.name).toBe('Cliente E2E');
  expect(sold.warrantyUntil).toBeTruthy();

  await page.getByRole('button', { name: es.pos.closeCash }).first().click();
  await expect(page.getByText('US$ 200')).toBeVisible(); // 100 iniciales + 100 de la venta
  expect(problems).toEqual([]);
});

test('servicio técnico: ingreso, presupuesto aprobado por el cliente desde el link y listo para retirar', async ({ page, browser }) => {
  await loginPhoneOwner(page);
  await page.goto('/repairs/new');
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido *').fill('Rita Reparación');
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await page.getByLabel('Marca y modelo *').fill('Samsung A34');
  await page.getByLabel('Falla que cuenta el cliente *').fill('No prende');
  await page.getByRole('button', { name: 'Guardar e imprimir comprobante' }).click();
  await expect(page.getByRole('heading', { name: /Samsung A34/ })).toBeVisible();

  await page.getByRole('button', { name: 'Editar presupuesto' }).click();
  await page.getByRole('button', { name: '+ Mano de obra' }).click();
  await page.locator('input[inputmode="decimal"]').last().fill('45000');
  await page.getByRole('button', { name: 'Guardar presupuesto' }).click();
  await page.getByRole('button', { name: 'Marcar enviado' }).click();
  await expect(page.getByText('Presupuesto enviado').first()).toBeVisible();

  const id = page.url().split('/repairs/')[1].split('?')[0];
  const { publicToken } = await (await page.request.get(`/api/repairs/${id}`)).json();
  // El cliente abre el link sin cuenta y aprueba.
  const client = await (await browser.newContext()).newPage();
  await client.goto(`/r/${publicToken}`);
  await expect(client.getByText('$ 45.000,00').first()).toBeVisible();
  client.on('dialog', (d) => void d.accept());
  await client.getByRole('button', { name: '✓ Aprobar' }).click();
  await expect(client.getByText('Presupuesto aprobado ✓')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'En reparación' }).click();
  await page.getByRole('button', { name: 'Listo para retirar' }).click();
  await expect(page.getByText('Avisar que está listo')).toBeVisible();
});

test('pedido por Instagram: cadete entrega, cobra y queda para rendir', async ({ page, browser }) => {
  await loginPhoneOwner(page);
  await page.goto('/orders/new');
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido *').fill('Olga Pedido');
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await page.getByPlaceholder('+ Agregar producto').fill('Cargador');
  await page.getByRole('button', { name: /Cargador 20W/ }).click();
  await page.getByLabel('Dirección').fill('Av. Corrientes 1234, CABA');
  await page.getByRole('button', { name: 'Guardar pedido' }).click();
  await expect(page.getByRole('heading', { name: /Pedido #\d+ · Olga Pedido/ })).toBeVisible();
  await page.getByRole('button', { name: '🛵 Asignar cadete' }).click();
  await page.locator('.modal select').selectOption({ label: 'Tomi (cadete)' });
  await page.getByRole('button', { name: 'Asignar', exact: true }).click();
  await expect(page.getByText('Asignado a cadete').first()).toBeVisible();

  const courier = await loginPhoneEmployee(browser, 'cadete', '3456');
  await courier.goto('/deliveries');
  const card = courier.locator('.card', { hasText: 'Olga Pedido' });
  await card.getByRole('button', { name: '✓ Entregado' }).click();
  await courier.getByRole('button', { name: 'Confirmar entrega' }).click();
  await expect(courier.getByText(/Para rendir en la caja/)).toBeVisible();

  const pending = (await (await page.request.get('/api/deliveries/pending-cash')).json()) as { courier: string; amount: number }[];
  expect(pending.find((p) => p.courier === 'Tomi (cadete)')?.amount).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText('Entregado').first()).toBeVisible();
});
