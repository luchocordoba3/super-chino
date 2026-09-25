import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { loginOwner } from './helpers';

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

test('mesas: sumar a la cuenta abierta, cobrarla y abrir otra', async ({ page }) => {
  await loginOwner(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: es.pos.linkThisPc }).click();
  await page.getByRole('button', { name: 'Sofía' }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: '✓' }).click();
  await page.getByLabel(es.pos.openingAmount).fill('5000');
  await page.getByRole('button', { name: es.pos.openCash }).click();

  // La mesa 2 de la demo está abierta con dos fernet y unas papas.
  const tickets = page.locator('.pos-tickets');
  await tickets.getByRole('button', { name: 'Mesa 2' }).click();
  const cart = page.locator('.pos-right .pos-cart');
  await expect(cart).toContainText('Fernet con coca');
  await expect(cart).toContainText('Papas fritas 150g');

  // Pidieron un café: se anota en la mesa.
  await page.locator('.pos-quick-cats').getByRole('button', { name: 'Bar' }).click();
  await page.locator('.pos-key', { hasText: 'Café' }).click();
  await expect(cart).toContainText('Café');
  await expect(page.locator('.pos-total')).toHaveText('$ 14.600,00');

  await page.getByRole('button', { name: es.tabs.pay.replace('{{label}}', 'Mesa 2') }).click();
  await page.getByRole('button', { name: es.pos.confirmSale }).click();
  await page.getByRole('button', { name: es.pos.newSale }).click();
  await expect(tickets.getByRole('button', { name: 'Mesa 2' })).toHaveCount(0);

  // Otra mesa: el tostado queda anotado para cobrar después.
  await tickets.getByRole('button', { name: new RegExp(es.tabs.open) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mesa 5' }).click();
  await page.locator('.pos-key', { hasText: 'Tostado' }).click();
  await expect(cart).toContainText('Tostado jamón y queso');
  await expect
    .poll(async () => (await (await page.request.get('/api/dashboard')).json()).openTabs)
    .toEqual({ count: 1, total: 4500 });
});

test('receta: armarla desde la ficha del producto', async ({ page }) => {
  await loginOwner(page);
  const created = await page.request.post('/api/products', { data: { name: 'Licuado de banana', price: 3500 } });
  const { id } = await created.json();
  await page.goto(`/products/${id}`);
  await page.getByRole('button', { name: es.recipe.make }).click();
  await page.getByPlaceholder(es.recipe.addIngredient).fill('leche');
  await page.getByRole('button', { name: /Leche entera 1L/ }).click();
  await page.getByLabel('Leche entera 1L').fill('0,3');
  await expect(page.getByText(/ganancia \d+%/)).toBeVisible();
  const recipeCard = page.locator('.card', { has: page.getByRole('heading', { name: new RegExp(es.recipe.title) }) });
  await recipeCard.getByRole('button', { name: es.common.save }).click();
  await expect(page.getByText(es.recipe.saved)).toBeVisible();
  await expect(page.locator('.badge', { hasText: es.recipe.badge })).toBeVisible();
});
