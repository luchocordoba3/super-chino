import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { type App, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

let app: App;
let owner: Owner;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  owner = await registerOwner(app);
});

describe('carga rápida por código de barras', () => {
  it('producto nuevo: código + nombre + precio + cantidad => queda listo para la caja', async () => {
    const res = await owner.api.post('/stock/quick', {
      barcode: '7790000000011',
      product: { name: 'Puré de tomate', price: 1200 },
      qty: 24,
      unitCost: 800,
      expiresAt: '2027-03-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.product).toMatchObject({ name: 'Puré de tomate', barcode: '7790000000011', price: 1200, cost: 800, stock: 24 });

    const found = await owner.api.get('/products/barcode/7790000000011');
    expect(found.body.product.stock).toBe(24);
  });

  it('producto existente: solo escaneo y cantidad, suma otro lote', async () => {
    await owner.api.post('/stock/quick', { barcode: '111', product: { name: 'Yerba', price: 3000 }, qty: 10 });
    const res = await owner.api.post('/stock/quick', { barcode: '111', qty: 5, expiresAt: '2027-01-01' });
    expect(res.body.created).toBe(false);
    expect(res.body.product.stock).toBe(15);
    expect(await prisma.lot.count()).toBe(2);
  });

  it('producto nuevo sin nombre o precio => error claro', async () => {
    const res = await owner.api.post('/stock/quick', { barcode: '222', qty: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('new_product_needs_name_and_price');
  });

  it('si sube el costo sugiere un precio que mantiene el margen', async () => {
    await owner.api.post('/stock/quick', { barcode: '333', product: { name: 'Aceite', price: 1400 }, qty: 1, unitCost: 1000 });
    const res = await owner.api.post('/stock/quick', { barcode: '333', qty: 12, unitCost: 1500 });
    // margen por defecto 40% y redondeo a $10
    expect(res.body.suggestion).toMatchObject({ oldPrice: 1400, suggestedPrice: 2100, cost: 1500 });
  });
});

describe('precios', () => {
  it('cambiar un precio queda registrado con quién lo hizo', async () => {
    const p = (await owner.api.post('/products', { name: 'Galletitas', price: 900 })).body;
    const res = await owner.api.patch(`/products/${p.id}`, { price: 1000 });
    expect(res.body.price).toBe(1000);
    const detail = (await owner.api.get(`/products/${p.id}`)).body;
    expect(detail.priceHistory[0]).toMatchObject({ oldPrice: 900, newPrice: 1000, source: 'manual', user: 'Li Wei' });
  });

  it('un empleado sin permiso de precios no puede cambiarlos', async () => {
    const p = (await owner.api.post('/products', { name: 'Galletitas', price: 900 })).body;
    const emp = await createEmployee(app, owner, { perms: ['sell', 'stock'] });
    expect((await emp.api.patch(`/products/${p.id}`, { price: 1 })).status).toBe(403);
    expect((await emp.api.patch(`/products/${p.id}`, { minStock: 5 })).status).toBe(200);
  });

  it('suba masiva con vista previa y aplicación, filtrando por categoría', async () => {
    const cat = (await owner.api.post('/categories', { name: 'Bebidas' })).body;
    await owner.api.post('/products', { name: 'Gaseosa', price: 1000, categoryId: cat.id });
    await owner.api.post('/products', { name: 'Agua', price: 505, categoryId: cat.id });
    await owner.api.post('/products', { name: 'Arroz', price: 800 });

    const preview = await owner.api.post('/products/bulk-price', { percent: 10, categoryId: cat.id });
    expect(preview.body).toMatchObject({ count: 2, applied: false });
    expect((await owner.api.get('/products?q=Gaseosa')).body[0].price).toBe(1000);

    await owner.api.post('/products/bulk-price', { percent: 10, categoryId: cat.id, dryRun: false });
    const list = (await owner.api.get('/products')).body as { name: string; price: number }[];
    expect(Object.fromEntries(list.map((p) => [p.name, p.price]))).toEqual({ Agua: 560, Arroz: 800, Gaseosa: 1100 });
  });

  it('el mismo código de barras no se puede repetir en un local', async () => {
    await owner.api.post('/products', { name: 'A', price: 1, barcode: '999' });
    const res = await owner.api.post('/products', { name: 'B', price: 1, barcode: '999' });
    expect(res.status).toBe(409);
  });
});

describe('ingresos, ajustes y mermas', () => {
  it('ingreso con varios renglones y lotes con vencimiento', async () => {
    const sup = (await owner.api.post('/suppliers', { name: 'Distribuidora Norte', phone: '+54 9 11 5555-0000' })).body;
    expect(sup.phone).toBe('5491155550000');
    const a = (await owner.api.post('/products', { name: 'Yogur', price: 900 })).body;
    const res = await owner.api.post('/stock/entries', {
      supplierId: sup.id,
      invoiceNumber: 'A-0001',
      items: [
        { productId: a.id, qty: 6, unitCost: 500, lotCode: 'L1', expiresAt: '2026-10-01' },
        { productId: a.id, qty: 6, unitCost: 500, lotCode: 'L2', expiresAt: '2026-11-01' },
      ],
    });
    expect(res.status).toBe(200);
    const detail = (await owner.api.get(`/products/${a.id}`)).body;
    expect(detail.stock).toBe(12);
    expect(detail.supplierId).toBe(sup.id);
    expect(detail.lots.map((l: { lotCode: string }) => l.lotCode)).toEqual(['L1', 'L2']);
  });

  it('merma y ajuste descuentan por FEFO; no se puede sacar más de lo que hay', async () => {
    const r = await owner.api.post('/stock/quick', { barcode: '444', product: { name: 'Leche', price: 1000 }, qty: 5, expiresAt: '2030-01-01' });
    const id = r.body.product.id;
    await owner.api.post('/stock/adjust', { productId: id, qty: -2, type: 'WASTE', reason: 'rotos' });
    await owner.api.post('/stock/adjust', { productId: id, qty: -10, type: 'ADJUSTMENT' });
    expect((await owner.api.get(`/products/${id}`)).body.stock).toBe(0);
    await owner.api.post('/stock/adjust', { productId: id, qty: 3 });
    const detail = (await owner.api.get(`/products/${id}`)).body;
    expect(detail.stock).toBe(3);
    expect(detail.movements.map((m: { type: string }) => m.type)).toContain('WASTE');
  });

  it('lotes por vencer ordenados por fecha', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Lejos', price: 1 }, qty: 1, expiresAt: '2030-01-01' });
    await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Cerca', price: 1 }, qty: 1, expiresAt: soon });
    const lots = (await owner.api.get('/stock/lots?within=7')).body;
    expect(lots.map((l: { product: string }) => l.product)).toEqual(['Cerca']);
  });

  it('otro local no puede cargar stock en mis productos', async () => {
    const p = (await owner.api.post('/products', { name: 'X', price: 1 })).body;
    const other = await registerOwner(app);
    expect((await other.api.post('/stock/entries', { items: [{ productId: p.id, qty: 1 }] })).status).toBe(404);
  });
});

describe('ingreso con productos nuevos en el mismo paso', () => {
  it('crea el producto y el lote juntos, y reusa el código si ya existía', async () => {
    await owner.api.post('/products', { name: 'Fideos', price: 700, barcode: '555' });
    const res = await owner.api.post('/stock/entries', {
      items: [
        { newProduct: { name: 'Arroz 1kg', price: 1500, barcode: '777' }, qty: 10, unitCost: 900 },
        { newProduct: { name: 'Fideos (otro nombre)', price: 1, barcode: '555' }, qty: 4 },
      ],
    });
    expect(res.status).toBe(200);
    const list = (await owner.api.get('/products')).body as { name: string; stock: number; cost: number }[];
    expect(list.map((p) => [p.name, p.stock])).toEqual([
      ['Arroz 1kg', 10],
      ['Fideos', 4],
    ]);
  });
});
