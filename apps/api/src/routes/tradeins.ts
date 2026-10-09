// Toma de usados (parte de pago) y compra a particulares, con los controles para no comprar equipos robados.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cleanImei, DEVICE_CHECKS, isValidImei, toArs } from '@super-chino/shared';
import { num, prisma, type Prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, HttpError, notFound, sentOnly } from '../lib/http';
import { fileUrl, readImage, saveImage } from '../lib/uploads';
import { storeRate } from '../services/fx';
import { publish } from '../services/notify';
import { nextNumber, serialEvent } from '../services/phones';
import { userNames } from '../services/store';

const PHOTO_KINDS = { dniFront: 'dniFront', dniBack: 'dniBack', selfie: 'selfie', enacom: 'enacomPhoto', signature: 'signature' } as const;

const body = z.object({
  customerId: z.string().nullish(),
  customer: z.object({ name: z.string().trim().min(1).max(80), dni: z.string().trim().max(20), phone: z.string().trim().max(30).nullish() }).nullish(),
  productId: z.string().nullish(),
  model: z.string().trim().min(1).max(120),
  imei1: z.string().trim().min(8).max(20),
  imei2: z.string().trim().max(20).nullish(),
  serial: z.string().trim().max(40).nullish(),
  color: z.string().trim().max(30).nullish(),
  grade: z.enum(['A', 'B', 'C']).nullish(),
  battery: z.number().int().min(0).max(100).nullish(),
  checklist: z.partialRecord(z.enum(DEVICE_CHECKS), z.boolean()).default({}),
  accountFree: z.boolean().default(false),
  imeiMatches: z.boolean().default(false),
  offeredUsd: z.number().min(0).max(1e6).default(0),
  payout: z.enum(['CREDIT', 'CASH']).default('CREDIT'),
  notes: z.string().trim().max(500).nullish(),
  enacomResult: z.enum(['CLEAN', 'REPORTED']).nullish(),
});

type Row = Prisma.TradeInGetPayload<{ include: { customer: true } }>;
const dto = (t: Row, names?: Map<string, string>) => ({
  ...t,
  offeredUsd: num(t.offeredUsd),
  user: names?.get(t.userId) ?? null,
  enacomByName: t.enacomBy ? (names?.get(t.enacomBy) ?? null) : null,
  photos: {
    dniFront: fileUrl(t.dniFront),
    dniBack: fileUrl(t.dniBack),
    selfie: fileUrl(t.selfie),
    enacom: fileUrl(t.enacomPhoto),
    signature: fileUrl(t.signature),
  },
  /** Lo que falta para poder aceptarla. */
  missing: [
    !t.dniFront && 'dniFront',
    !t.dniBack && 'dniBack',
    t.enacomResult !== 'CLEAN' && 'enacom',
    !t.enacomPhoto && 'enacomPhoto',
    !t.accountFree && 'accountFree',
    !t.imeiMatches && 'imeiMatches',
    !t.signature && 'signature',
    !t.productId && 'product',
    num(t.offeredUsd) <= 0 && 'price',
  ].filter(Boolean) as string[],
});

async function load(storeId: string, id: string) {
  const t = await prisma.tradeIn.findFirst({ where: { id, storeId }, include: { customer: true } });
  if (!t) throw notFound();
  return t;
}

export async function tradeInRoutes(app: FastifyInstance) {
  app.get('/tradeins', guard('tradeins', 'reports'), async (req) => {
    const q = z.object({ status: z.enum(['DRAFT', 'ACCEPTED', 'REJECTED']).optional(), q: z.string().trim().max(40).optional() }).parse(req.query);
    const d = q.q?.replace(/\D/g, '') ?? '';
    const rows = await prisma.tradeIn.findMany({
      where: {
        storeId: req.auth.sid,
        status: q.status,
        ...(q.q ? { OR: [{ model: { contains: q.q, mode: 'insensitive' } }, ...(d.length >= 4 ? [{ imei1: { contains: d } }] : []), { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await userNames(prisma, req.auth.sid);
    return rows.map((t) => dto(t, names));
  });

  /** Precio sugerido según la grilla (modelo + grado); con batería baja se descuenta un 10 %. */
  app.get('/tradeins/quote', guard('tradeins'), async (req) => {
    const q = z.object({ productId: z.string(), grade: z.enum(['A', 'B', 'C']), battery: z.coerce.number().int().min(0).max(100).optional() }).parse(req.query);
    const row = await prisma.tradeInPrice.findFirst({ where: { storeId: req.auth.sid, productId: q.productId, grade: q.grade } });
    if (!row) return { price: null };
    const base = num(row.price);
    const lowBattery = q.battery != null && q.battery < 80;
    return { price: lowBattery ? Math.round(base * 0.9) : base, base, lowBattery };
  });

  app.get('/tradeins/:id', guard('tradeins', 'reports'), async (req) => {
    const { id } = req.params as { id: string };
    return dto(await load(req.auth.sid, id), await userNames(prisma, req.auth.sid));
  });

  app.post('/tradeins', guard('tradeins'), async (req) => {
    const b = body.parse(req.body);
    const storeId = req.auth.sid;
    const t = await prisma.$transaction(async (tx) => {
      let customerId = b.customerId ?? null;
      if (customerId && !(await tx.customer.findFirst({ where: { id: customerId, storeId } }))) throw notFound('customer_not_found');
      if (!customerId) {
        if (!b.customer) throw badRequest('customer_required');
        const dni = b.customer.dni.replace(/\D/g, '');
        const existing = dni ? await tx.customer.findFirst({ where: { storeId, dni } }) : null;
        customerId =
          existing?.id ??
          (await tx.customer.create({ data: { storeId, name: b.customer.name, dni: dni || null, phone: b.customer.phone?.replace(/\D/g, '') || null } })).id;
      }
      if (b.productId && !(await tx.product.findFirst({ where: { id: b.productId, storeId } }))) throw notFound('product_not_found');
      return tx.tradeIn.create({
        data: {
          storeId,
          number: await nextNumber(tx, 'tradeIn', storeId),
          customerId,
          productId: b.productId ?? null,
          model: b.model,
          imei1: cleanImei(b.imei1),
          imei2: b.imei2 ? cleanImei(b.imei2) : null,
          serial: b.serial || null,
          color: b.color || null,
          grade: b.grade ?? null,
          battery: b.battery ?? null,
          checklist: b.checklist,
          accountFree: b.accountFree,
          imeiMatches: b.imeiMatches,
          offeredUsd: b.offeredUsd,
          payout: b.payout,
          notes: b.notes || null,
          userId: req.auth.uid,
          ...(b.enacomResult ? { enacomResult: b.enacomResult, enacomAt: new Date(), enacomBy: req.auth.uid } : {}),
        },
        include: { customer: true },
      });
    });
    publish(storeId, 'phones');
    return dto(t);
  });

  app.patch('/tradeins/:id', guard('tradeins'), async (req) => {
    const { id } = req.params as { id: string };
    const b = sentOnly(body.omit({ customer: true, customerId: true }).partial().parse(req.body), req.body);
    const t = await load(req.auth.sid, id);
    if (t.status !== 'DRAFT') throw badRequest('trade_in_closed');
    if (b.productId && !(await prisma.product.findFirst({ where: { id: b.productId, storeId: req.auth.sid } }))) throw notFound('product_not_found');
    const { enacomResult, imei1, imei2, ...rest } = b;
    const updated = await prisma.tradeIn.update({
      where: { id },
      data: {
        ...rest,
        ...(imei1 ? { imei1: cleanImei(imei1) } : {}),
        ...(imei2 !== undefined ? { imei2: imei2 ? cleanImei(imei2) : null } : {}),
        // Cambiar el IMEI obliga a volver a consultar ENACOM.
        ...(imei1 && cleanImei(imei1) !== t.imei1 ? { enacomResult: null, enacomAt: null, enacomBy: null, enacomPhoto: null } : {}),
        ...(enacomResult ? { enacomResult, enacomAt: new Date(), enacomBy: req.auth.uid } : {}),
      },
      include: { customer: true },
    });
    publish(req.auth.sid, 'phones');
    return dto(updated);
  });

  /** Fotos: DNI frente y dorso, selfie, captura de ENACOM y firma de la declaración. */
  app.post('/tradeins/:id/photo', guard('tradeins'), async (req) => {
    const { id } = req.params as { id: string };
    const { kind } = z.object({ kind: z.enum(Object.keys(PHOTO_KINDS) as [keyof typeof PHOTO_KINDS]) }).parse(req.query);
    const t = await load(req.auth.sid, id);
    if (t.status !== 'DRAFT') throw badRequest('trade_in_closed');
    const img = await readImage(req);
    if (!img?.data.length) throw badRequest('invalid_image');
    const path = await saveImage(req.auth.sid, img.data, img.mimetype);
    await prisma.tradeIn.update({ where: { id }, data: { [PHOTO_KINDS[kind]]: path } });
    return { url: fileUrl(path) };
  });

  /** Aceptar: el equipo entra al stock como usado, con costo = lo que se pagó por él. */
  app.post('/tradeins/:id/accept', guard('tradeins'), async (req) => {
    const { id } = req.params as { id: string };
    const storeId = req.auth.sid;
    const t = await load(storeId, id);
    if (t.status !== 'DRAFT') throw badRequest('trade_in_closed');
    if (t.enacomResult === 'REPORTED') throw new HttpError(400, 'imei_reported');
    const view = dto(t);
    if (view.missing.length) throw new HttpError(400, 'trade_in_incomplete', view.missing.join(','));
    if (!isValidImei(t.imei1)) throw badRequest('invalid_imei');
    const product = await prisma.product.findFirstOrThrow({ where: { id: t.productId!, storeId } });
    const { rate } = await storeRate(storeId);
    const cost = product.currency === 'USD' ? num(t.offeredUsd) : toArs(num(t.offeredUsd), 'USD', rate);
    await prisma.$transaction(async (tx) => {
      // Si el equipo ya pasó por el local (se vendió antes), se reutiliza su ficha y su historia.
      const prev = await tx.serialItem.findFirst({ where: { storeId, OR: [{ imei1: t.imei1 }, { imei2: t.imei1 }] } });
      if (prev && prev.status !== 'SOLD' && prev.status !== 'SCRAPPED') throw new HttpError(409, 'imei_in_stock');
      const data = {
        productId: product.id,
        imei2: t.imei2,
        serial: t.serial,
        condition: 'USED' as const,
        grade: t.grade,
        battery: t.battery,
        color: t.color,
        accountFree: t.accountFree,
        cost,
        price: null,
        origin: t.payout === 'CASH' ? 'PURCHASE' : 'TRADE_IN',
        status: 'AVAILABLE' as const,
        receivedAt: new Date(),
        soldAt: null,
        saleId: null,
        customerId: null,
        warrantyUntil: null,
        supplierId: null,
      };
      const s = prev
        ? await tx.serialItem.update({ where: { id: prev.id }, data })
        : await tx.serialItem.create({ data: { ...data, storeId, imei1: t.imei1 } });
      await serialEvent(tx, { serialItemId: s.id, type: 'TRADE_IN', status: 'AVAILABLE', refId: t.id, userId: req.auth.uid, note: `Toma #${t.number}` });
      if (!product.serialized) await tx.product.update({ where: { id: product.id }, data: { serialized: true } });
      await tx.tradeIn.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), serialItemId: s.id } });
    });
    publish(storeId, 'phones');
    publish(storeId, 'catalog');
    return dto(await load(storeId, id));
  });

  app.post('/tradeins/:id/reject', guard('tradeins'), async (req) => {
    const { id } = req.params as { id: string };
    const t = await load(req.auth.sid, id);
    if (t.status !== 'DRAFT') throw badRequest('trade_in_closed');
    const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
    await prisma.tradeIn.update({ where: { id }, data: { status: 'REJECTED', notes: [t.notes, reason].filter(Boolean).join(' · ') || null } });
    publish(req.auth.sid, 'phones');
    return { ok: true };
  });

  /** Libro de compras de usados (CSV): lo que pide CABA (Ley 6.009) y otras provincias. */
  app.get('/tradeins-book.csv', guard('owner'), async (req, reply) => {
    const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const rows = await prisma.tradeIn.findMany({
      where: {
        storeId: req.auth.sid,
        status: 'ACCEPTED',
        acceptedAt: { gte: q.from ? new Date(`${q.from}T00:00:00-03:00`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59-03:00`) : undefined },
      },
      include: { customer: true },
      orderBy: { acceptedAt: 'asc' },
    });
    const names = await userNames(prisma, req.auth.sid);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Nº', 'Fecha', 'Modelo', 'IMEI 1', 'IMEI 2', 'Serie', 'Estado', 'Batería %', 'Vendedor (particular)', 'DNI', 'Teléfono', 'Domicilio', 'ENACOM', 'Consultado', 'Valor USD', 'Forma', 'Atendió'];
    const lines = rows.map((t) =>
      [
        t.number,
        t.acceptedAt?.toISOString().slice(0, 10),
        t.model,
        t.imei1,
        t.imei2,
        t.serial,
        t.grade ? `Usado ${t.grade}` : 'Usado',
        t.battery,
        t.customer.name,
        t.customer.dni,
        t.customer.phone,
        t.customer.address,
        t.enacomResult === 'CLEAN' ? 'Sin denuncia' : t.enacomResult,
        t.enacomAt?.toISOString().slice(0, 16).replace('T', ' '),
        num(t.offeredUsd),
        t.payout === 'CASH' ? 'Compra' : 'Parte de pago',
        names.get(t.userId),
      ]
        .map(esc)
        .join(','),
    );
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="libro-usados.csv"');
    return '﻿' + [header.map(esc).join(','), ...lines].join('\n');
  });
}
