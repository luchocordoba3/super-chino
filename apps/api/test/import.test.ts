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

describe('importar catálogo', () => {
  it('crea y actualiza productos, categorías, proveedores y stock inicial', async () => {
    await owner.api.post('/products', { name: 'Yerba vieja', price: 3000, barcode: '779001' });
    const res = await owner.api.post('/products/import', {
      rows: [
        { row: 2, barcode: '779001', name: 'Yerba mate 1kg', price: 4500, cost: 3100, category: 'Almacén', supplier: 'Distribuidora Norte' },
        { row: 3, barcode: '779002', name: 'Puré de tomate 520g', price: 1200, stock: 24, expiresAt: '2027-03-01', category: 'almacén' },
        { row: 4, name: 'Pan casero', price: 900, unit: 'KG' },
        { row: 5, barcode: '779003', price: 100 },
        { row: 6, name: 'Sin precio' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 2, updated: 1, unchanged: 0, stockLines: 1 });
    expect(res.body.errors).toEqual([
      { row: 5, error: 'missing_name' },
      { row: 6, error: 'missing_price' },
    ]);

    const list = (await owner.api.get('/products')).body as { name: string; price: number; stock: number; category: string; supplier: string; contentQty: number; contentUnit: string; unit: string }[];
    const byName = Object.fromEntries(list.map((p) => [p.name, p]));
    expect(byName['Yerba mate 1kg']).toMatchObject({ price: 4500, category: 'Almacén', supplier: 'Distribuidora Norte', contentQty: 1, contentUnit: 'kg' });
    expect(byName['Puré de tomate 520g']).toMatchObject({ stock: 24, category: 'Almacén', contentQty: 520, contentUnit: 'g' });
    expect(byName['Pan casero'].unit).toBe('KG');
    expect(await prisma.category.count()).toBe(1);
    expect((await prisma.priceChange.findFirstOrThrow()).source).toBe('import');

    // Volver a importar lo mismo no duplica nada.
    const again = await owner.api.post('/products/import', { rows: [{ row: 2, barcode: '779001', name: 'Yerba mate 1kg', price: 4500 }], addStock: false });
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('sin permiso de precios no se puede importar', async () => {
    const emp = await createEmployee(app, owner, { perms: ['stock'] });
    expect((await emp.api.post('/products/import', { rows: [{ row: 2, name: 'X', price: 1 }] })).status).toBe(403);
  });

  it('filtra los productos con precio cambiado desde una fecha (para imprimir etiquetas)', async () => {
    const a = (await owner.api.post('/products', { name: 'A', price: 100 })).body;
    await prisma.product.updateMany({ data: { createdAt: new Date('2020-01-01') } });
    await owner.api.post('/products', { name: 'B viejo', price: 100 });
    await prisma.product.updateMany({ where: { name: 'B viejo' }, data: { createdAt: new Date('2020-01-01') } });
    await owner.api.patch(`/products/${a.id}`, { price: 150 });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const names = ((await owner.api.get(`/products?priceChangedSince=${yesterday}`)).body as { name: string }[]).map((p) => p.name);
    expect(names).toEqual(['A']);
    expect((await owner.api.get(`/products?priceChangedSince=${today}&q=zzz`)).body).toEqual([]);
  });
});
