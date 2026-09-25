import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginEmployee, loginOwner, PURE, tinyPng, watchProblems } from './helpers';

test('equipo y tareas: el dueño da de alta a Carla, le manda una tarea con foto y ella la completa', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/team');
  await page.getByLabel(es.common.name).fill('Carla');
  await page.getByLabel(es.login.username).fill('carla');
  await page.getByLabel(es.login.pin).fill('4321');
  await page.getByRole('button', { name: es.common.add }).click();
  await expect(page.getByText('@carla')).toBeVisible();

  await page.goto('/messages');
  await page.getByRole('button', { name: es.messages.compose }).click();
  await page.getByLabel(es.messages.text).fill('Llená la heladera de bebidas');
  await page.getByLabel('Carla').check();
  await page.getByLabel(es.messages.task).check();
  await page.getByLabel(es.messages.requiresPhoto).check();
  await page.getByRole('button', { name: es.common.send }).click();

  const emp = await (await browser.newContext()).newPage();
  const empProblems = watchProblems(emp);
  await loginEmployee(emp, 'carla', '4321');
  await expect(emp.getByText('Llená la heladera de bebidas')).toBeVisible();
  await emp.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(emp.getByText(es.home.noTasks)).toBeVisible();

  await page.getByRole('button', { name: es.messages.sent }).click();
  const card = page.locator('.card', { hasText: 'Llená la heladera de bebidas' });
  await expect(card.getByText(es.messages.doneBy.replace('{{name}}', 'Carla'))).toBeVisible();
  await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect([...problems, ...empProblems]).toEqual([]);
});

test('caja: anular una venta, imprimir ticket y cerrar caja con arqueo', async ({ page }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Martín' }).click();
  for (const d of '5678') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('1000');
  await page.getByRole('button', { name: es.pos.openCash }).click();

  const scan = page.getByPlaceholder(es.pos.scanHere);
  await scan.fill(PURE);
  await scan.press('Enter');
  await expect(page.getByText('Puré de tomate 520g')).toBeVisible();
  // Si la página se recarga (actualización, F5), el carrito sigue ahí.
  await page.reload();
  await page.getByRole('button', { name: 'Martín' }).click();
  for (const d of '5678') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await expect(page.getByText('Puré de tomate 520g')).toBeVisible();
  await page.keyboard.press('F12');
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await page.getByRole('button', { name: es.pos.newSale }).click();
  await expect(page.getByText(es.pos.emptyCart)).toBeVisible();

  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByTitle(es.pos.printTicket).first().click();
  await expect(page.locator('.ticket')).toContainText(es.pos.ticketFooter);

  page.once('dialog', (d) => void d.accept('error de carga'));
  await page.getByRole('button', { name: es.pos.voidSale }).first().click();
  await expect.poll(async () => (await (await page.request.get('/api/sales')).json())[0].status).toBe('VOIDED');

  // Se le paga al proveedor con plata de la caja: el cierre lo descuenta.
  await page.getByRole('button', { name: es.pos.cashMove }).click();
  await page.getByLabel(es.pos.amount).fill('300');
  await page.getByRole('dialog').locator('select').selectOption({ label: 'Distribuidora Norte' });
  await page.getByLabel(es.common.reason).fill('Factura 123');
  await page.getByRole('dialog').getByRole('button', { name: es.common.save }).click();

  await page.getByRole('button', { name: es.pos.closeCash }).click();
  await expect(page.getByRole('dialog')).toContainText('700');
  await page.getByLabel(es.pos.countedAmount).fill('700');
  await page.getByLabel(es.pos.handoverNotes).fill('Falta cambio chico, pedir monedas.');
  await page.getByRole('dialog').getByRole('button', { name: es.pos.closeCash }).click();
  await expect(page.getByText(es.pos.cashClosed)).toBeVisible();
  await expect
    .poll(async () => {
      const [s] = await (await page.request.get('/api/cash-sessions')).json();
      return s.closedAt ? s.difference : 'abierta';
    })
    .toBe(0);

  // Pase de turno: el que abre la caja ve las novedades que dejó Martín.
  await page.getByRole('dialog').getByRole('button', { name: es.common.close, exact: true }).last().click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await expect(page.locator('.handover')).toContainText('Falta cambio chico, pedir monedas.');
  await expect(page.locator('.handover')).toContainText('Martín');
  expect(problems).toEqual([]);
});

test('conteo sorpresa a ciegas, aviso al dueño y pedido de reposición por WhatsApp', async ({ page, browser }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: es.count.title }).click();
  await expect(page.getByText(`${es.count.title} ✓`)).toBeVisible();
  // Para no tocar el stock que usan otras pruebas, el conteo que se completa es de productos fijos.
  const ids = [];
  for (const q of ['Lavandina', 'Detergente']) ids.push((await (await page.request.get(`/api/products?q=${q}`)).json())[0].id);
  expect((await page.request.post('/api/counts', { data: { productIds: ids } })).ok()).toBe(true);

  const emp = await (await browser.newContext()).newPage();
  const empProblems = watchProblems(emp);
  await loginEmployee(emp, 'sofia', '1234');
  await emp.getByRole('link', { name: es.messages.openCount }).first().click();
  await expect(emp.getByText(es.count.blindHelp)).toBeVisible();
  for (const input of await emp.locator('input[inputmode=decimal]').all()) await input.fill('0');
  await emp.getByRole('button', { name: es.count.submit }).click();
  await expect(emp.getByRole('heading', { name: es.count.result })).toBeVisible();

  await page.goto('/alerts');
  await expect(page.getByText(/Conteo/).first()).toBeVisible();
  await page.goto('/reorder');
  await expect(page.locator('a[href^="https://wa.me/549110000000"]').first()).toBeVisible();
  expect([...problems, ...empProblems]).toEqual([]);
});

test('ajustes: se pueden escribir decimales y quedan guardados', async ({ page }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/settings');
  const field = page.getByLabel(es.settings.countDiffThreshold);
  await field.fill('0,5');
  await expect(field).toHaveValue('0,5');
  await page.getByRole('button', { name: es.common.save, exact: true }).click();
  await expect(page.getByText(es.common.saved)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(es.settings.countDiffThreshold)).toHaveValue('0.5');
  expect(problems).toEqual([]);
});
