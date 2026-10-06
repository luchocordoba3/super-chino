import { expect, test } from '@playwright/test';

// PNG de 1×1 para simular la foto que sube el visitante.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('consulta en la web → presupuesto → el cliente lo acepta', async ({ page, browser }) => {
  const name = `Cliente E2E ${Date.now().toString(36)}`;

  // 1. El visitante pide presupuesto desde la web de la vidriería.
  await page.goto('/cristales-ariel');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Vidrios, mamparas y espejos');
  await page.locator('#presupuesto select').first().selectOption('Mampara de baño');
  await page.getByLabel('Ancho (cm)').fill('120');
  await page.getByLabel('Alto (cm)').fill('180');
  await page.locator('.site-photo-add input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.site-photo img')).toHaveCount(1);
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByLabel('Tu WhatsApp').fill('11 5555-0909');
  await page.getByRole('button', { name: 'Pedir presupuesto' }).click();
  await expect(page.getByText('Recibimos tu consulta')).toBeVisible();

  // 2. Ariel la ve en el panel y la presupuesta desde la plantilla.
  await page.goto('/login');
  await page.getByLabel('Email').fill('ariel@demo.com');
  await page.getByLabel('Contraseña').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Consultas nuevas')).toBeVisible();
  await page.goto('/panel/consultas');
  await page.locator('.lead-card', { hasText: name }).click();
  await expect(page.locator('.photos img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Presupuestar' }).click();
  await expect(page.getByLabel('Ancho en mm')).toHaveValue('1200');
  await expect(page.locator('.line-name > span', { hasText: 'Templado 8 mm' })).toBeVisible();
  await page.locator('#resumen').getByRole('button', { name: 'Guardar presupuesto' }).click();
  const wa = page.locator('#resumen').getByRole('link', { name: 'Enviar por WhatsApp' });
  await expect(wa).toBeVisible();
  const href = decodeURIComponent((await wa.getAttribute('href'))!);
  expect(href).toContain('https://wa.me/5491155550909');
  const link = href.match(/\/p\/[\w-]+/)![0];

  // 3. El cliente abre el link y lo acepta.
  const client = await browser.newPage();
  await client.goto(link);
  await expect(client.getByText(`Para ${name}`)).toBeVisible();
  await client.getByRole('button', { name: 'Acepto el presupuesto' }).click();
  await client.getByRole('button', { name: 'Sí, acepto' }).click();
  await expect(client.getByText('Presupuesto aceptado')).toBeVisible();

  // 4. En el panel queda aceptado.
  await page.reload();
  await expect(page.locator('h1 .chip-status')).toHaveText('Aceptado');
});

test('la web pública trae título y vista previa para WhatsApp', async ({ request }) => {
  const html = await (await request.get('/cristales-ariel')).text();
  expect(html).toContain('<title>Cristales Ariel');
  expect(html).toContain('og:description');
});
