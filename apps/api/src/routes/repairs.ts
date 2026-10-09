// Servicio técnico: órdenes de reparación, presupuesto que el cliente aprueba desde un link y repuestos del stock.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEVICE_CHECKS, REPAIR_STATUS_LABELS, REPAIR_STATUSES, round2, toArs } from '@super-chino/shared';
import type { RepairStatus } from '@prisma/client';
import { num, prisma, type Prisma, type Tx } from '../db';
import { addDays } from '../domain/dates';
import { env } from '../env';
import { guard } from '../lib/auth';
import { decrypt, encrypt, randomToken } from '../lib/crypto';
import { badRequest, notFound, sentOnly } from '../lib/http';
import { fileUrl, readImage, saveImage } from '../lib/uploads';
import { storeRate } from '../services/fx';
import { ownerIds, publish, pushTo } from '../services/notify';
import { nextNumber, setSerialStatus } from '../services/phones';
import { consumeStock } from '../services/stock';
import { storeCtx, userNames } from '../services/store';

const QuoteLine = z.object({
  kind: z.enum(['PART', 'LABOR']),
  productId: z.string().nullish(),
  name: z.string().trim().min(1).max(120),
  qty: z.number().positive().max(100).default(1),
  price: z.number().min(0).max(1e9),
});
type QuoteLine = z.infer<typeof QuoteLine>;
const quoteTotal = (lines: QuoteLine[]) => round2(lines.reduce((s, l) => s + l.qty * l.price, 0));

const createBody = z.object({
  customerId: z.string().nullish(),
  customer: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).nullish(), dni: z.string().trim().max(20).nullish() }).nullish(),
  serialItemId: z.string().nullish(),
  device: z.string().trim().min(1).max(120),
  imei: z.string().trim().max(20).nullish(),
  problem: z.string().trim().min(1).max(1000),
  accessories: z.string().trim().max(200).nullish(),
  checklist: z.partialRecord(z.enum(DEVICE_CHECKS), z.enum(['ok', 'bad', 'na'])).default({}),
  lockType: z.enum(['NONE', 'PIN', 'PATTERN', 'PASSWORD']).default('NONE'),
  lockSecret: z.string().max(100).nullish(),
  technicianId: z.string().nullish(),
  promisedAt: z.iso.datetime().nullish(),
  currency: z.enum(['ARS', 'USD']).default('ARS'),
  diagnosisFee: z.number().min(0).max(1e9).default(0),
  quote: z.array(QuoteLine).max(40).default([]),
  warrantyOfId: z.string().nullish(),
});

type Row = Prisma.RepairOrderGetPayload<{ include: { customer: true } }>;

function dto(r: Row, names: Map<string, string>, showSecret: boolean, stuckDays: number) {
  const { lockSecret, ...rest } = r;
  const open = !['DELIVERED', 'CANCELLED'].includes(r.status);
  return {
    ...rest,
    quoteTotal: num(r.quoteTotal),
    diagnosisFee: num(r.diagnosisFee),
    partsCost: num(r.partsCost),
    technician: r.technicianId ? (names.get(r.technicianId) ?? null) : null,
    user: names.get(r.userId) ?? null,
    photos: r.photos.map((p) => fileUrl(p)),
    hasLock: !!lockSecret,
    lockSecret: showSecret && lockSecret ? decrypt(lockSecret) : null,
    /** Lo que se cobra al entregar: el presupuesto, o solo el diagnóstico si lo rechazó. */
    charge: chargeOf(r),
    daysOpen: Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000),
    stuck: open && r.status !== 'READY' && Date.now() - r.updatedAt.getTime() > stuckDays * 86_400_000,
  };
}

export const chargeOf = (r: { quoteApproved: boolean | null; quoteTotal: Prisma.Decimal | number; diagnosisFee: Prisma.Decimal | number; warrantyOfId: string | null }) =>
  r.warrantyOfId ? 0 : r.quoteApproved === false ? num(r.diagnosisFee) : num(r.quoteTotal);

/** Descuenta del stock los repuestos del presupuesto (una sola vez) y guarda su costo en pesos. */
async function useParts(tx: Tx, storeId: string, r: { id: string; quote: unknown; partsUsed: boolean }, userId: string) {
  if (r.partsUsed) return;
  const lines = z.array(QuoteLine).catch([]).parse(r.quote).filter((l) => l.kind === 'PART' && l.productId);
  const { today } = await storeCtx(tx, storeId);
  const { rate } = await storeRate(storeId, tx);
  let cost = 0;
  for (const l of lines) {
    const p = await tx.product.findFirst({ where: { id: l.productId!, storeId } });
    if (!p || p.isService || p.serialized) continue;
    const allocs = await consumeStock(tx, { storeId, productId: p.id, qty: l.qty, today, type: 'REPAIR', refId: r.id, userId, reason: 'reparación' });
    cost += toArs(allocs.reduce((s, a) => s + a.qty * a.unitCost, 0), p.currency, rate);
  }
  await tx.repairOrder.update({ where: { id: r.id }, data: { partsUsed: true, partsCost: round2(cost) } });
}

async function load(storeId: string, id: string) {
  const r = await prisma.repairOrder.findFirst({ where: { id, storeId }, include: { customer: true } });
  if (!r) throw notFound();
  return r;
}

export async function repairRoutes(app: FastifyInstance) {
  const view = async (req: { auth: { sid: string; uid: string; role: string } }, r: Row) => {
    const { settings } = await storeCtx(prisma, req.auth.sid);
    const showSecret = req.auth.role === 'OWNER' || r.technicianId === req.auth.uid;
    return dto(r, await userNames(prisma, req.auth.sid), showSecret, settings.repairStuckDays);
  };

  app.get('/repairs', guard('repairs', 'sell', 'reports'), async (req) => {
    const q = z.object({ status: z.enum(REPAIR_STATUSES).optional(), open: z.coerce.boolean().optional(), mine: z.coerce.boolean().optional(), q: z.string().trim().max(40).optional() }).parse(req.query);
    const { settings } = await storeCtx(prisma, req.auth.sid);
    const rows = await prisma.repairOrder.findMany({
      where: {
        storeId: req.auth.sid,
        status: q.status ?? (q.open ? { notIn: ['DELIVERED', 'CANCELLED'] } : undefined),
        technicianId: q.mine ? req.auth.uid : undefined,
        ...(q.q
          ? {
              OR: [
                { device: { contains: q.q, mode: 'insensitive' } },
                { imei: { contains: q.q.replace(/\D/g, '') || q.q } },
                { customer: { name: { contains: q.q, mode: 'insensitive' } } },
                ...(/^\d+$/.test(q.q) ? [{ number: Number(q.q) }] : []),
              ],
            }
          : {}),
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const names = await userNames(prisma, req.auth.sid);
    return rows.map((r) => dto(r, names, false, settings.repairStuckDays));
  });

  app.get('/repairs/:id', guard('repairs', 'sell', 'reports'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await load(req.auth.sid, id);
    const [events, names, original] = await Promise.all([
      prisma.repairEvent.findMany({ where: { repairId: id }, orderBy: { createdAt: 'desc' } }),
      userNames(prisma, req.auth.sid),
      r.warrantyOfId ? prisma.repairOrder.findUnique({ where: { id: r.warrantyOfId }, select: { id: true, number: true, deliveredAt: true } }) : null,
    ]);
    const deposits = await prisma.deposit.findMany({ where: { storeId: req.auth.sid, repairOrderId: id } });
    return {
      ...(await view(req, r)),
      events: events.map((e) => ({ ...e, user: e.userId ? (names.get(e.userId) ?? null) : null })),
      original,
      deposits: deposits.map((d) => ({ id: d.id, amount: num(d.amount), currency: d.currency, fx: d.fx == null ? null : num(d.fx), status: d.status })),
    };
  });

  app.post('/repairs', guard('repairs', 'sell'), async (req) => {
    const b = createBody.parse(req.body);
    const storeId = req.auth.sid;
    const { settings } = await storeCtx(prisma, storeId);
    const r = await prisma.$transaction(async (tx) => {
      let customerId = b.customerId ?? null;
      if (customerId && !(await tx.customer.findFirst({ where: { id: customerId, storeId } }))) throw notFound('customer_not_found');
      if (!customerId) {
        if (!b.customer) throw badRequest('customer_required');
        const phone = b.customer.phone?.replace(/\D/g, '') || null;
        const dni = b.customer.dni?.replace(/\D/g, '') || null;
        const same = dni || phone ? await tx.customer.findFirst({ where: { storeId, OR: [...(dni ? [{ dni }] : []), ...(phone ? [{ phone }] : [])] } }) : null;
        customerId = same?.id ?? (await tx.customer.create({ data: { storeId, name: b.customer.name, phone, dni } })).id;
      }
      if (b.technicianId && !(await tx.user.findFirst({ where: { id: b.technicianId, storeId } }))) throw notFound('user_not_found');
      let warrantyOfId: string | null = null;
      if (b.warrantyOfId) {
        const orig = await tx.repairOrder.findFirst({ where: { id: b.warrantyOfId, storeId } });
        if (!orig) throw notFound();
        const until = orig.deliveredAt ? addDays(orig.deliveredAt, orig.warrantyDays) : null;
        if (!until || until < new Date()) throw badRequest('warranty_expired');
        warrantyOfId = orig.id;
      }
      let serialItemId: string | null = null;
      if (b.serialItemId) {
        const s = await tx.serialItem.findFirst({ where: { id: b.serialItemId, storeId } });
        if (!s) throw notFound('serial_not_found');
        serialItemId = s.id;
        // Equipo del stock que se manda a reparar/reacondicionar: deja de estar a la venta.
        if (s.status === 'AVAILABLE' || s.status === 'RESERVED') await setSerialStatus(tx, s.id, 'IN_REPAIR', { type: 'REPAIR', userId: req.auth.uid });
      }
      const created = await tx.repairOrder.create({
        data: {
          storeId,
          number: await nextNumber(tx, 'repairOrder', storeId),
          customerId,
          serialItemId,
          device: b.device,
          imei: b.imei?.replace(/\D/g, '') || null,
          problem: b.problem,
          accessories: b.accessories || null,
          checklist: b.checklist,
          lockType: b.lockType,
          lockSecret: b.lockSecret ? encrypt(b.lockSecret) : null,
          technicianId: b.technicianId ?? null,
          promisedAt: b.promisedAt ? new Date(b.promisedAt) : null,
          currency: b.currency,
          diagnosisFee: warrantyOfId ? 0 : b.diagnosisFee,
          quote: b.quote,
          quoteTotal: quoteTotal(b.quote),
          warrantyDays: settings.repairWarrantyDays,
          warrantyOfId,
          publicToken: randomToken(18),
          userId: req.auth.uid,
        },
        include: { customer: true },
      });
      await tx.repairEvent.create({ data: { repairId: created.id, status: 'RECEIVED', userId: req.auth.uid, note: warrantyOfId ? 'Reingreso por garantía' : null } });
      return created;
    });
    publish(storeId, 'repairs');
    if (r.technicianId && r.technicianId !== req.auth.uid) {
      await pushTo([r.technicianId], { title: `Reparación #${r.number}`, body: `${r.device}: ${r.problem}`.slice(0, 140), url: `/repairs/${r.id}` });
    }
    return view(req, r);
  });

  app.patch('/repairs/:id', guard('repairs', 'sell'), async (req) => {
    const { id } = req.params as { id: string };
    const parsed = createBody
      .pick({ device: true, imei: true, problem: true, accessories: true, checklist: true, lockType: true, lockSecret: true, technicianId: true, promisedAt: true, currency: true, diagnosisFee: true, quote: true })
      .partial()
      .extend({
        status: z.enum(REPAIR_STATUSES).optional(),
        diagnosis: z.string().trim().max(1000).nullish(),
        /** Nota para el historial; public = la ve el cliente en el link. */
        note: z.string().trim().max(500).optional(),
        public: z.boolean().default(true),
        /** Respuesta del cliente tomada en el local o por teléfono. */
        quoteApproved: z.boolean().optional(),
      })
      .parse(req.body);
    const b = { ...sentOnly(parsed, req.body), public: parsed.public };
    const storeId = req.auth.sid;
    const r = await load(storeId, id);
    if (r.status === 'DELIVERED' || r.status === 'CANCELLED') {
      if (b.status !== undefined) throw badRequest('repair_closed');
    }
    if (b.status === 'DELIVERED' && chargeOf({ ...r, quoteTotal: b.quote ? quoteTotal(b.quote) : r.quoteTotal }) > 0 && !r.saleId) {
      // Si hay algo para cobrar, la entrega se hace cobrando en la caja.
      throw badRequest('charge_in_pos');
    }
    if (b.technicianId && !(await prisma.user.findFirst({ where: { id: b.technicianId, storeId } }))) throw notFound('user_not_found');
    const updated = await prisma.$transaction(async (tx) => {
      const { status, note, public: isPublic, lockSecret, quote, promisedAt, imei, quoteApproved, ...rest } = b;
      const data: Prisma.RepairOrderUpdateInput = { ...rest };
      if (lockSecret !== undefined) data.lockSecret = lockSecret ? encrypt(lockSecret) : null;
      if (quote) {
        if (r.partsUsed && JSON.stringify(quote.filter((l) => l.kind === 'PART')) !== JSON.stringify(z.array(QuoteLine).catch([]).parse(r.quote).filter((l) => l.kind === 'PART'))) {
          throw badRequest('parts_already_used');
        }
        data.quote = quote;
        data.quoteTotal = quoteTotal(quote);
      }
      if (promisedAt !== undefined) data.promisedAt = promisedAt ? new Date(promisedAt) : null;
      if (imei !== undefined) data.imei = imei?.replace(/\D/g, '') || null;
      if (quoteApproved !== undefined) {
        data.quoteApproved = quoteApproved;
        data.quoteAnswerAt = new Date();
        data.quoteAnswerBy = 'local';
      }
      let newStatus: RepairStatus | undefined = status ?? (quoteApproved === undefined ? undefined : quoteApproved ? 'APPROVED' : 'REJECTED');
      if (newStatus === r.status) newStatus = undefined;
      if (newStatus) {
        data.status = newStatus;
        if (newStatus === 'QUOTE_SENT') data.quoteSentAt = new Date();
        if (newStatus === 'READY') data.readyAt = new Date();
        if (newStatus === 'DELIVERED') data.deliveredAt = new Date();
        if (newStatus === 'APPROVED' && quoteApproved === undefined) data.quoteApproved = true;
        if (newStatus === 'REJECTED' && quoteApproved === undefined) data.quoteApproved = false;
      }
      await tx.repairOrder.update({ where: { id }, data });
      if (newStatus || note) {
        await tx.repairEvent.create({ data: { repairId: id, status: newStatus ?? null, note: note ?? null, userId: req.auth.uid, public: isPublic } });
      }
      // Al empezar a reparar (o al terminar) se descuentan los repuestos del stock.
      if (newStatus === 'IN_REPAIR' || (newStatus === 'READY' && (data.quoteApproved ?? r.quoteApproved) !== false)) {
        await useParts(tx, storeId, { id, quote: data.quote ?? r.quote, partsUsed: r.partsUsed }, req.auth.uid);
      }
      // Equipo del stock reacondicionado: vuelve a la venta con el costo de los repuestos sumado.
      if (r.serialItemId && (newStatus === 'READY' || newStatus === 'DELIVERED' || newStatus === 'CANCELLED')) {
        const s = await tx.serialItem.findUnique({ where: { id: r.serialItemId }, include: { product: true } });
        if (s?.status === 'IN_REPAIR' && !s.saleId) {
          const fresh = await tx.repairOrder.findUniqueOrThrow({ where: { id } });
          const { rate } = await storeRate(storeId, tx);
          const extra = s.product.currency === 'USD' && rate ? round2(num(fresh.partsCost) / rate) : num(fresh.partsCost);
          await setSerialStatus(tx, s.id, 'AVAILABLE', { type: 'STATUS', refId: id, userId: req.auth.uid, note: `Reparación #${r.number}`, data: { cost: round2(num(s.cost) + extra) } });
        } else if (s?.status === 'IN_REPAIR') {
          await setSerialStatus(tx, s.id, 'SOLD', { type: 'STATUS', refId: id, userId: req.auth.uid, note: `Reparación #${r.number}` });
        }
      }
      return tx.repairOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    });
    publish(storeId, 'repairs');
    if (b.status === 'READY' || b.technicianId) publish(storeId, 'catalog');
    return view(req, updated);
  });

  app.post('/repairs/:id/photo', guard('repairs', 'sell'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await load(req.auth.sid, id);
    const img = await readImage(req);
    if (!img?.data.length) throw badRequest('invalid_image');
    const path = await saveImage(req.auth.sid, img.data, img.mimetype);
    await prisma.repairOrder.update({ where: { id }, data: { photos: [...r.photos, path].slice(-10) } });
    return { url: fileUrl(path) };
  });

  // ---------- Link público para el cliente (sin login) ----------
  const publicLimit = { config: { rateLimit: { max: env.isTest ? 10_000 : 60, timeWindow: '1 minute' } } };

  app.get('/public/repairs/:token', publicLimit, async (req) => {
    const { token } = req.params as { token: string };
    const r = await prisma.repairOrder.findUnique({ where: { publicToken: token }, include: { store: { select: { name: true } } } });
    if (!r) throw notFound();
    const events = await prisma.repairEvent.findMany({ where: { repairId: r.id, public: true }, orderBy: { createdAt: 'asc' } });
    const lines = z.array(QuoteLine).catch([]).parse(r.quote);
    return {
      store: r.store.name,
      number: r.number,
      device: r.device,
      problem: r.problem,
      status: r.status,
      statusLabel: REPAIR_STATUS_LABELS[r.status],
      diagnosis: r.diagnosis,
      quote: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
      quoteTotal: num(r.quoteTotal),
      diagnosisFee: num(r.diagnosisFee),
      currency: r.currency,
      promisedAt: r.promisedAt,
      quoteApproved: r.quoteApproved,
      canAnswer: r.status === 'QUOTE_SENT',
      warrantyDays: r.warrantyDays,
      createdAt: r.createdAt,
      events: events.map((e) => ({ status: e.status, label: e.status ? REPAIR_STATUS_LABELS[e.status] : null, note: e.note, at: e.createdAt })),
    };
  });

  /** El cliente aprueba o rechaza el presupuesto desde su celular (queda registrado con fecha y hora). */
  app.post('/public/repairs/:token/answer', publicLimit, async (req) => {
    const { token } = req.params as { token: string };
    const b = z.object({ approve: z.boolean() }).parse(req.body);
    const r = await prisma.repairOrder.findUnique({ where: { publicToken: token } });
    if (!r) throw notFound();
    if (r.status !== 'QUOTE_SENT') throw badRequest('quote_not_pending');
    const status = b.approve ? 'APPROVED' : 'REJECTED';
    await prisma.$transaction([
      prisma.repairOrder.update({ where: { id: r.id }, data: { status, quoteApproved: b.approve, quoteAnswerAt: new Date(), quoteAnswerBy: 'cliente' } }),
      prisma.repairEvent.create({ data: { repairId: r.id, status, note: b.approve ? 'El cliente aprobó el presupuesto' : 'El cliente rechazó el presupuesto', public: true } }),
    ]);
    publish(r.storeId, 'repairs');
    const to = [...new Set([...(await ownerIds(r.storeId)), ...(r.technicianId ? [r.technicianId] : [])])];
    await pushTo(to, { title: `Reparación #${r.number}`, body: b.approve ? 'El cliente aprobó el presupuesto' : 'El cliente rechazó el presupuesto', url: `/repairs/${r.id}` });
    return { ok: true, status };
  });

  /** Técnicos: quienes tienen el permiso de servicio técnico (y el dueño). */
  app.get('/technicians', guard(), async (req) => {
    const users = await prisma.user.findMany({ where: { storeId: req.auth.sid, active: true }, select: { id: true, name: true, role: true, perms: true } });
    return users.filter((u) => u.role === 'OWNER' || u.perms.includes('repairs')).map((u) => ({ id: u.id, name: u.name }));
  });

}
