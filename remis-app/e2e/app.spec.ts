import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Ningún error de JavaScript en la página durante las pruebas.
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('un día de trabajo completo, con copia de seguridad', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-12T10:00:00-03:00'));
  await page.goto('/');

  // Primera vez: maneja remis (agencia)
  await page.getByRole('button', { name: 'Remis (agencia)' }).click();
  await page.getByLabel('Marca y modelo').fill('Toyota Etios');
  await page.getByLabel('Patente').fill('aa 111 bb');
  await page.getByLabel('Km que marca hoy').fill('150000');
  await page.getByLabel('Lo comparto con otro chofer').check();
  await page.getByLabel('A los km').fill('141000');
  await page.getByRole('radio', { name: 'Porcentaje' }).click();
  await page.getByLabel('Porcentaje de lo recaudado').fill('20');
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();

  await expect(page.locator('.hero')).toHaveText('150.000 km');
  await expect(page.getByText('Se acerca: Aceite y filtro de aceite')).toBeVisible();
  await expect(page.getByText('faltan 1.000 km')).toBeVisible();

  // Empieza el turno recibiendo el auto con medio tanque
  await page.getByRole('button', { name: 'Empezar turno' }).click();
  await expect(page.getByLabel('Km del odómetro')).toHaveValue('150.000');
  await page.getByRole('radio', { name: '½' }).click();
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page.getByText('Turno en curso')).toBeVisible();

  // Carga de GNC
  await page.getByRole('button', { name: 'Combustible' }).click();
  await page.getByLabel('m³').fill('12,5');
  await page.getByLabel('Total pagado').fill('9875');
  await expect(page.getByText('Precio: $ 790 por m³')).toBeVisible();
  await page.getByLabel('Km del odómetro').fill('150120');
  await page.getByLabel('Estación').fill('GNC Centro');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('GNC: $ 9.875 anotado')).toBeVisible();

  // Peaje nuevo que queda guardado como favorito, y después de un toque
  await page.getByRole('button', { name: 'Peaje' }).click();
  await page.getByLabel('Monto').fill('1800');
  await page.getByLabel('Dónde').fill('Autopista');
  await page.getByLabel('Guardarlo en mis peajes').check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Peaje' }).click();
  await page.getByRole('button', { name: /Autopista/ }).click();
  await expect(page.getByText('Peaje $ 1.800 anotado')).toBeVisible();

  // Termina el turno con lo recaudado
  await page.getByRole('button', { name: 'Terminar turno' }).click();
  await page.getByLabel('Km del odómetro').fill('150250');
  await expect(page.getByText('Hiciste 250 km en este turno.')).toBeVisible();
  await page.getByLabel('Recaudado en viajes').fill('120000');
  await expect(page.getByText('La agencia se lleva $ 24.000 (20%).')).toBeVisible();
  await page.getByLabel('Viajes', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Terminar', exact: true }).click();
  await expect(page.getByText('Turno terminado: 250 km')).toBeVisible();

  const stat = (label: string) => page.locator('.stat', { hasText: label }).locator('.v');
  await expect(stat('Km hoy')).toHaveText('250 km');
  await expect(stat('Recaudado')).toHaveText('$ 120.000');
  await expect(stat('Gastos')).toHaveText('$ 13.475');
  await expect(stat('Ganancia')).toHaveText('$ 82.525');
  await expect(page.getByText('faltan 750 km')).toBeVisible();

  // Movimientos
  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.getByText('Turno · 250 km')).toBeVisible();
  await expect(page.getByText('GNC · 12,5 m³')).toBeVisible();

  // Service: el aviso del aceite se va
  await page.getByRole('link', { name: 'Auto' }).click();
  await page.getByRole('button', { name: 'Registrar service' }).click();
  await page.getByRole('checkbox', { name: 'Aceite y filtro de aceite' }).check();
  await page.getByLabel('Cuánto pagaste').fill('60000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.item', { hasText: 'Aceite y filtro de aceite' }).locator('.badge')).toHaveText('Al día');

  // Resumen de la semana
  await page.getByRole('link', { name: 'Resumen' }).click();
  await expect(page.locator('.hero')).toHaveText('$ 22.525');
  await expect(page.getByText(/Rinde \d/)).toHaveCount(0);

  // Copia de seguridad: descargar, borrar todo y restaurar
  await page.getByRole('link', { name: 'Ajustes' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar' }).click()]);
  expect(dl.suggestedFilename()).toBe('rinde-copia-2026-05-12.json');
  const file = test.info().outputPath('copia.json');
  await dl.saveAs(file);
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await expect(page.getByRole('button', { name: 'Empezar', exact: true })).toBeVisible();
  // El archivo va como contenido: Chromium no adjunta rutas con acentos (como la carpeta de esta prueba).
  await page.getByTestId('restore-onb').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.getByText('Copia restaurada')).toBeVisible();
  await page.getByRole('link', { name: 'Hoy' }).click();
  await expect(page.locator('.topkm strong')).toHaveText('150.250 km');
  await expect(stat('Recaudado')).toHaveText('$ 120.000');
});

test('los datos de ejemplo muestran avisos y el gráfico', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Primero quiero verla con datos de ejemplo').click();
  await expect(page.getByText('Venció: Oblea de GNC')).toBeVisible();
  await expect(page.getByText(/Rinde menos el GNC/)).toBeVisible();
  await page.getByRole('link', { name: 'Resumen' }).click();
  await expect(page.getByRole('img', { name: 'Km por día' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver como tabla' }).click();
  await expect(page.getByRole('columnheader', { name: 'Otro chofer' })).toBeVisible();
  // El aviso del otro auto lleva a ese auto
  await page.getByRole('link', { name: 'Hoy' }).click();
  await page.getByRole('button', { name: /AC 456 EF: Falta cargar la quincena/ }).click();
  await expect(page.getByText('Lo maneja Juan · 50% para el chofer')).toBeVisible();
  await expect(page.locator('.topkm')).toContainText('AC 456 EF');
});

test('segundo auto con chofer: la liquidación de la quincena', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-12T10:00:00-03:00'));
  // El menú de compartir del celular: guardamos el texto para revisarlo.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { shared?: string }).shared = data.text;
      },
    });
  });
  await page.goto('/');

  // Tu auto: lo que paga la agencia ya viene descontado
  await page.getByRole('button', { name: 'Remis (agencia)' }).click();
  await page.getByLabel('Marca y modelo').fill('Toyota Etios');
  await page.getByLabel('Patente').fill('aa 111 bb');
  await page.getByLabel('Km que marca hoy').fill('150000');
  await expect(page.getByRole('radio', { name: 'Ya descontado' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Empezar turno' })).toBeVisible();

  // Otro auto, para un chofer al 50%
  await page.getByRole('button', { name: /Cambiar de auto/ }).click();
  await page.getByRole('button', { name: 'Agregar otro auto' }).click();
  await page.getByLabel('Marca y modelo').fill('Fiat Cronos');
  await page.getByLabel('Patente').fill('ac 456 ef');
  await page.getByLabel('Km que marca hoy').fill('64000');
  await expect(page.getByRole('radio', { name: 'Un chofer' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Nombre del chofer').fill('Juan');
  await expect(page.getByLabel('Parte del chofer (%)')).toHaveValue('50');
  await page.getByRole('button', { name: 'Agregar auto' }).click();

  // La quincena: se facturó $ 1.000.000 con $ 200.000 de peajes con pasajero
  await expect(page.getByText('Lo maneja Juan · 50% para el chofer')).toBeVisible();
  await page.getByRole('button', { name: 'Cargar la quincena del 1 al 15/05' }).click();
  await page.getByLabel('Lo que facturó').fill('1000000');
  await page.getByRole('textbox', { name: /^Peajes con pasajero/ }).fill('200000');
  await page.getByLabel('Km del odómetro al cierre').fill('66500');
  await expect(page.getByTestId('chofer-total')).toHaveText('$ 600.000');
  await expect(page.getByTestId('owner-total')).toHaveText('$ 400.000');
  await page.getByRole('button', { name: 'Mandarle la cuenta a Juan' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared?: string }).shared ?? '')).toMatch(/Te corresponden: \$\s600\.000/);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Liquidación guardada: te quedan $ 400.000')).toBeVisible();
  await expect(page.locator('.topkm strong')).toHaveText('66.500 km');

  // Resumen de la semana: la quincena cierra el viernes 15
  await page.getByRole('link', { name: 'Resumen' }).click();
  await expect(page.locator('.hero')).toHaveText('$ 400.000');
  await expect(page.getByTestId('fleet-total')).toHaveText('$ 400.000');

  // Volver a tu auto desde arriba
  await page.getByRole('button', { name: /Cambiar de auto/ }).click();
  await page.getByRole('button', { name: /AA 111 BB/ }).click();
  await page.getByRole('link', { name: 'Hoy' }).click();
  await expect(page.getByRole('button', { name: 'Empezar turno' })).toBeVisible();
});

test('abre sin internet después de la primera vez', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rinde' })).toBeVisible();
  await context.setOffline(false);
});

test('choferes de apps: lo que hiciste en cada app y ¿me conviene el viaje?', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-28T10:00:00-03:00'));
  await page.goto('/');
  await expect(page.getByText('14 días gratis.')).toBeVisible();
  await page.getByRole('button', { name: 'Uber', exact: true }).click();
  await page.getByRole('button', { name: 'DiDi', exact: true }).click();
  await page.getByLabel('Marca y modelo').fill('Fiat Cronos');
  await page.getByLabel('Km que marca hoy').fill('80000');
  await page.getByRole('radio', { name: 'Alquilado' }).click();
  await page.getByLabel('Alquiler', { exact: true }).fill('120000');
  await page.getByLabel('¿Cuánto querés hacer por día?').fill('60000');
  await page.getByLabel('Monotributo').selectOption('G');
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();

  // Alquiler de la semana y meta
  await expect(page.getByText('Alquiler de la semana')).toBeVisible();
  await expect(page.getByText('Falta pagar $ 120.000')).toBeVisible();
  await expect(page.getByText('Meta de hoy')).toBeVisible();

  // Turno con lo de cada app
  await page.getByRole('button', { name: 'Empezar turno' }).click();
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await page.getByRole('button', { name: 'Terminar turno' }).click();
  await page.getByLabel('Km del odómetro').fill('80180');
  await page.getByLabel('Uber', { exact: true }).fill('30000');
  await page.getByLabel('Viajes en Uber').fill('8');
  await page.getByLabel('DiDi', { exact: true }).fill('20000');
  await page.getByLabel('Viajes en DiDi').fill('5');
  await page.getByRole('button', { name: 'Terminar', exact: true }).click();
  const stat = (label: string) => page.locator('.stat', { hasText: label }).locator('.v');
  await expect(stat('Recaudado')).toHaveText('$ 50.000');
  await expect(page.getByText('Te faltan $ 10.000')).toBeVisible();

  await page.getByRole('link', { name: 'Movimientos' }).click();
  await expect(page.locator('.item', { hasText: 'Uber' }).first()).toContainText('8 viajes');
  await page.getByRole('link', { name: 'Resumen' }).click();
  const apps = page.locator('section', { has: page.getByRole('heading', { name: 'Por app' }) });
  await expect(apps).toContainText('Uber');
  await expect(apps).toContainText('$ 30.000');
  await expect(apps).toContainText('DiDi');

  // ¿Me conviene este viaje? Sin datos de costo todavía: se carga a mano.
  await page.getByRole('link', { name: 'Hoy' }).click();
  await page.getByRole('button', { name: '¿Me conviene este viaje?' }).click();
  await page.getByRole('button', { name: 'Ajustar costo y mínimos' }).click();
  await page.getByLabel('Lo que te cuesta cada km').fill('200');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByLabel('Te pagan').fill('5000');
  await page.getByLabel('Km hasta el pasajero').fill('2');
  await page.getByLabel('Km del viaje').fill('8');
  await expect(page.getByRole('status', { name: /Conviene: te quedan \$\s3\.000/ })).toBeVisible();
  await page.getByLabel('Te pagan').fill('2500');
  await expect(page.getByRole('status', { name: /No conviene/ })).toBeVisible();
});

test('la prueba vence, el chofer transfiere y se activa con el código del vendedor', async ({ browser }) => {
  const opts = { viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' };
  const buyerCtx = await browser.newContext(opts);
  const buyer = await buyerCtx.newPage();
  buyer.on('pageerror', (e) => errors.push(e.message));
  buyer.on('dialog', (d) => void d.accept());
  // WhatsApp: guardamos el link en vez de abrirlo.
  await buyer.addInitScript(() => {
    window.open = (url?: string | URL) => {
      (window as unknown as { opened?: string }).opened = String(url);
      return null;
    };
  });
  await buyer.clock.setFixedTime(new Date('2026-10-01T10:00:00-03:00'));
  await buyer.goto('/');
  await buyer.getByRole('button', { name: 'Uber', exact: true }).click();
  await buyer.getByLabel('Km que marca hoy').fill('50000');
  await buyer.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(buyer.getByRole('button', { name: 'Empezar turno' })).toBeVisible();

  // Pasan 19 días: se terminó la prueba
  await buyer.clock.setFixedTime(new Date('2026-10-20T10:00:00-03:00'));
  await buyer.reload();
  await expect(buyer.getByText('Se terminó la prueba gratis').first()).toBeVisible();
  await buyer.getByRole('button', { name: 'Combustible' }).click();
  await expect(buyer.getByRole('dialog', { name: 'Activá Rinde' })).toBeVisible();
  await expect(buyer.getByText('rinde.prueba')).toBeVisible();
  const id = (await buyer.locator('.sheet strong.mono').textContent())!.trim();
  expect(id).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await buyer.getByRole('button', { name: 'Mandar comprobante por WhatsApp' }).click();
  const wa = await buyer.evaluate(() => (window as unknown as { opened?: string }).opened ?? '');
  expect(wa).toContain('https://wa.me/5491100000000?text=');
  expect(decodeURIComponent(wa)).toContain(`Mi código de celular es ${id}`);
  expect(decodeURIComponent(wa)).toMatch(/plan anual \(\$\s20\.000\)/);

  // El vendedor, en su celular, carga su clave y genera el código para ese celular
  const sellerCtx = await browser.newContext(opts);
  const seller = await sellerCtx.newPage();
  seller.on('pageerror', (e) => errors.push(e.message));
  await seller.clock.setFixedTime(new Date('2026-10-20T11:00:00-03:00'));
  await seller.goto('/');
  await seller.getByRole('button', { name: 'Remis (agencia)' }).click();
  await seller.getByLabel('Km que marca hoy').fill('150000');
  await seller.getByRole('button', { name: 'Empezar', exact: true }).click();
  await seller.getByRole('link', { name: 'Ajustes' }).click();
  for (let i = 0; i < 5; i++) await seller.getByText(/Anda sin internet · Tus datos/).click();
  await expect(seller.getByRole('heading', { name: 'Vendedor', exact: true })).toBeVisible();
  await seller.getByTestId('seller-key').setInputFiles({ name: 'clave.json', mimeType: 'application/json', buffer: readFileSync('e2e/clave-vendedor-prueba.json') });
  await expect(seller.getByText('Listo: esta versión de la app reconoce tu clave')).toBeVisible();
  await seller.getByLabel('Código del celular del cliente').fill(id.toLowerCase());
  await seller.getByLabel('Nombre (opcional)').fill('Juan');
  await seller.getByRole('button', { name: 'Generar código' }).click();
  await expect(seller.getByText('vale del 20/10/26 al 19/10/27', { exact: false })).toBeVisible();
  const link = await seller.getByTestId('activation-link').inputValue();
  expect(link).toMatch(/\/activar#/);
  await seller.getByRole('button', { name: 'Otro código' }).click();
  await expect(seller.getByTestId('yearly')).toHaveText('$ 20.000');

  // El chofer toca el link: queda activa y vuelve a poder anotar
  await buyer.goto(link);
  await expect(buyer.getByText('Plan anual a nombre de Juan: activa hasta el 19/10/27.')).toBeVisible();
  await buyer.getByRole('button', { name: 'Abrir Rinde' }).click();
  await expect(buyer.getByText('Se terminó la prueba gratis')).toHaveCount(0);
  await buyer.getByRole('button', { name: 'Combustible' }).click();
  await expect(buyer.getByRole('dialog', { name: 'Activá Rinde' })).toHaveCount(0);
  await expect(buyer.getByRole('dialog')).toBeVisible();

  // Un código para otro celular no sirve; un promo sirve en cualquiera
  await seller.getByRole('radio', { name: 'Promo para cualquiera' }).click();
  await seller.getByRole('button', { name: 'Generar código' }).click();
  const promo = await seller.getByTestId('activation-link').inputValue();
  const thirdCtx = await browser.newContext(opts);
  const third = await thirdCtx.newPage();
  third.on('pageerror', (e) => errors.push(e.message));
  await third.clock.setFixedTime(new Date('2026-10-21T10:00:00-03:00'));
  await third.goto(link);
  await expect(third.getByText('Código guardado')).toBeVisible();
  await third.goto(promo);
  await expect(third.getByText('Código guardado')).toBeVisible();
  await third.getByRole('button', { name: 'Abrir Rinde' }).click();
  await third.getByRole('button', { name: 'Uber', exact: true }).click();
  await third.getByLabel('Km que marca hoy').fill('10000');
  await third.getByRole('button', { name: 'Empezar', exact: true }).click();
  await third.getByRole('link', { name: 'Ajustes' }).click();
  await expect(third.getByText('Promo: activa hasta el 26/10/26.')).toBeVisible();
  await Promise.all([buyerCtx.close(), sellerCtx.close(), thirdCtx.close()]);
});
