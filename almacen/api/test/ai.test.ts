import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiService, type InvoiceData } from '../src/ai';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { similarity } from '../src/domain/text';
import { type App, multipart, type Owner, registerOwner, resetDb, tinyPng } from './helpers';

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
afterEach(() => vi.restoreAllMocks());

const upload = (kind: string) => {
  const mp = multipart({}, { name: 'file', filename: 'foto.png', type: 'image/png', data: tinyPng });
  return app.inject({ method: 'POST', url: `/api/ai/scan?kind=${kind}`, payload: mp.payload, headers: { ...mp.headers, cookie: owner.cookie } });
};

function fakeReader(data: unknown) {
  vi.spyOn(aiService, 'enabled').mockReturnValue(true);
  return vi.spyOn(aiService, 'readImage').mockResolvedValue({ data: data as InvoiceData, usage: { model: 'test', input: 1500, output: 800 } });
}

describe('lectura de fotos con IA', () => {
  it('parecido de textos para relacionar la factura con el catálogo', () => {
    expect(similarity('PURE TOMATE ARCOR 520G', 'Puré de tomate Arcor 520g')).toBeGreaterThan(0.6);
    expect(similarity('Lavandina 1L', 'Yerba mate 1kg')).toBeLessThan(0.3);
  });

  it('factura: relaciona renglones por código y por nombre, y se confirma como ingreso', async () => {
    const sup = (await owner.api.post('/suppliers', { name: 'Distribuidora Norte SA' })).body;
    const pure = (await owner.api.post('/products', { name: 'Puré de tomate Arcor 520g', price: 1200 })).body;
    const yerba = (await owner.api.post('/products', { name: 'Yerba mate 1kg', price: 4500, barcode: '7790000000028' })).body;
    fakeReader({
      supplierName: 'DISTRIBUIDORA NORTE S.A.',
      invoiceNumber: 'A-0001-00001234',
      date: '2026-09-20',
      items: [
        { description: 'PURE TOMATE ARCOR 520G', barcode: null, quantity: 24, unitCost: 850, lotCode: null, expiresAt: '2027-05-01' },
        { description: 'YERBA X 1KG', barcode: '7790000000028', quantity: 10, unitCost: 3200, lotCode: 'L55', expiresAt: 'no se lee' },
        { description: 'GALLETITAS NUEVAS', barcode: null, quantity: 12, unitCost: 500, lotCode: null, expiresAt: null },
      ],
    });
    const res = await upload('invoice');
    expect(res.statusCode).toBe(200);
    const { id, result } = res.json();
    expect(result.supplierId).toBe(sup.id);
    expect(result.items[0].match).toMatchObject({ productId: pure.id });
    expect(result.items[1]).toMatchObject({ match: { productId: yerba.id, score: 1 }, expiresAt: null });
    expect(result.items[2].match).toBeNull();
    expect(await prisma.aiUsage.count({ where: { feature: 'invoice' } })).toBe(1);

    const confirm = await owner.api.post('/stock/entries', {
      supplierId: result.supplierId,
      invoiceNumber: result.invoiceNumber,
      invoiceScanId: id,
      items: [
        { productId: pure.id, qty: 24, unitCost: 850, expiresAt: '2027-05-01' },
        { productId: yerba.id, qty: 10, unitCost: 3200, lotCode: 'L55' },
        { newProduct: { name: 'Galletitas nuevas', price: 900 }, qty: 12, unitCost: 500 },
      ],
    });
    expect(confirm.status).toBe(200);
    expect((await prisma.invoiceScan.findUniqueOrThrow({ where: { id } })).status).toBe('confirmed');
    expect(await prisma.product.count()).toBe(3);
    // La misma foto no se puede confirmar dos veces.
    expect((await owner.api.post('/stock/entries', { invoiceScanId: id, items: [{ productId: pure.id, qty: 1 }] })).status).toBe(400);
  });

  it('etiqueta: lee lote y vencimiento', async () => {
    fakeReader({ productName: 'Yogur', barcode: '779-123', lotCode: 'L12', expiresAt: '2026-12-31' });
    const res = await upload('label');
    expect(res.json().result).toEqual({ productName: 'Yogur', barcode: '779123', lotCode: 'L12', expiresAt: '2026-12-31' });
  });

  it('respeta el límite diario de fotos por local', async () => {
    await owner.api.patch('/store', { settings: { aiDailyScanLimit: 1 } });
    fakeReader({ productName: null, barcode: null, lotCode: null, expiresAt: null });
    expect((await upload('label')).statusCode).toBe(200);
    expect((await upload('label')).json().error).toBe('limit_reached');
  });

  it('sin IA configurada avisa con un error claro', async () => {
    const res = await upload('invoice');
    expect(res.json().error).toBe('ai_disabled');
  });

  it('si la IA falla responde 422 y no rompe nada', async () => {
    vi.spyOn(aiService, 'enabled').mockReturnValue(true);
    vi.spyOn(aiService, 'readImage').mockRejectedValue(new Error('boom'));
    const res = await upload('invoice');
    expect(res.statusCode).toBe(422);
    expect((await prisma.invoiceScan.findFirstOrThrow()).status).toBe('failed');
  });
});
