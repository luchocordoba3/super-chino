import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATEGORIES, CURRENCIES, UNITS, catalogItemSchema, templateSchema } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/catalog', guard(), async (req) => {
    const { all } = req.query as { all?: string };
    return prisma.catalogItem.findMany({
      where: { businessId: req.auth.bid, ...(all ? {} : { active: true }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  app.post('/catalog', guard('owner'), async (req) => {
    const body = catalogItemSchema.parse(req.body);
    return prisma.catalogItem.create({ data: { ...body, businessId: req.auth.bid } });
  });

  app.patch('/catalog/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const body = catalogItemSchema.partial().parse(req.body);
    const r = await prisma.catalogItem.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.catalogItem.findUniqueOrThrow({ where: { id } });
  });

  /** Se da de baja (no se borra): los presupuestos viejos y las plantillas lo siguen nombrando. */
  app.delete('/catalog/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.catalogItem.updateMany({ where: { id, businessId: req.auth.bid }, data: { active: false } });
    if (!r.count) throw notFound();
    return { ok: true };
  });

  /** Suba o baja de precios por %, opcionalmente solo una categoría o una moneda. */
  app.post('/catalog/bulk-price', guard('owner'), async (req) => {
    const body = z
      .object({ pct: z.number().finite().min(-90).max(1000), category: z.enum(CATEGORIES).nullish(), currency: z.enum(CURRENCIES).nullish() })
      .parse(req.body);
    const items = await prisma.catalogItem.findMany({
      where: { businessId: req.auth.bid, active: true, ...(body.category ? { category: body.category } : {}), ...(body.currency ? { currency: body.currency } : {}) },
    });
    const f = 1 + body.pct / 100;
    await prisma.$transaction(items.map((i) => prisma.catalogItem.update({ where: { id: i.id }, data: { price: Math.round(Number(i.price) * f * 100) / 100 } })));
    return { updated: items.length };
  });

  /** Importa la lista del proveedor: actualiza por nombre (sin distinguir mayúsculas) o crea. */
  app.post('/catalog/import', guard('owner'), async (req) => {
    const rows = z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          price: z.number().finite().min(0).max(1e12),
          currency: z.enum(CURRENCIES),
          unit: z.enum(UNITS),
          category: z.enum(CATEGORIES),
          thicknessMm: z.number().finite().min(0).max(200).nullish(),
          cost: z.number().finite().min(0).max(1e12).nullish(),
        }),
      )
      .max(5000)
      .parse(req.body);
    if (!rows.length) throw badRequest('empty', 'La planilla no tiene filas');
    const existing = await prisma.catalogItem.findMany({ where: { businessId: req.auth.bid } });
    const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
    let created = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const prev = byName.get(r.name.toLowerCase());
        if (prev) {
          await tx.catalogItem.update({ where: { id: prev.id }, data: { ...r, active: true, isGlass: r.category === 'VIDRIO' } });
          updated++;
        } else {
          const c = await tx.catalogItem.create({ data: { ...r, businessId: req.auth.bid, isGlass: r.category === 'VIDRIO' } });
          byName.set(c.name.toLowerCase(), c);
          created++;
        }
      }
    });
    return { created, updated };
  });

  // Plantillas de trabajo
  app.get('/templates', guard(), async (req) => prisma.template.findMany({ where: { businessId: req.auth.bid }, orderBy: [{ sort: 'asc' }, { name: 'asc' }] }));

  const checkLines = async (bid: string, lines: { catalogItemId: string }[]) => {
    const ids = [...new Set(lines.map((l) => l.catalogItemId))];
    const n = await prisma.catalogItem.count({ where: { businessId: bid, id: { in: ids } } });
    if (n !== ids.length) throw badRequest('catalog_item_not_found', 'Hay un ítem que no está en tu catálogo');
  };

  app.post('/templates', guard('owner'), async (req) => {
    const body = templateSchema.parse(req.body);
    await checkLines(req.auth.bid, body.lines);
    return prisma.template.create({ data: { ...body, businessId: req.auth.bid } });
  });

  app.put('/templates/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const body = templateSchema.parse(req.body);
    await checkLines(req.auth.bid, body.lines);
    const r = await prisma.template.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.template.findUniqueOrThrow({ where: { id } });
  });

  app.delete('/templates/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.template.deleteMany({ where: { id, businessId: req.auth.bid } });
    if (!r.count) throw notFound();
    return { ok: true };
  });
}
