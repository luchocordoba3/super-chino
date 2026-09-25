import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type CashMoveKind, cashMoveSign, round2 } from '@almacen/shared';
import { num, prisma } from '../db';
import { addDays, dateOnly, startOfLocalDay } from '../domain/dates';
import { guard } from '../lib/auth';
import { notFound } from '../lib/http';
import { storeCtx, userNames } from '../services/store';

export async function salesRoutes(app: FastifyInstance) {
  /** Ventas de un día (fecha local del negocio). */
  app.get('/sales', guard('reports'), async (req) => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), userId: z.string().optional() }).parse(req.query);
    const { store } = await storeCtx(prisma, req.auth.sid);
    const from = q.date ? startOfLocalDay(store.timezone, new Date(dateOnly(q.date).getTime() + 12 * 3_600_000)) : startOfLocalDay(store.timezone);
    const [sales, names] = await Promise.all([
      prisma.sale.findMany({
        where: { storeId: req.auth.sid, userId: q.userId, occurredAt: { gte: from, lt: addDays(from, 1) } },
        include: { _count: { select: { items: true } } },
        orderBy: { occurredAt: 'desc' },
      }),
      userNames(prisma, req.auth.sid),
    ]);
    return sales.map((s) => ({
      id: s.id,
      occurredAt: s.occurredAt,
      user: names.get(s.userId) ?? null,
      status: s.status,
      total: num(s.total),
      costTotal: num(s.costTotal),
      discountTotal: num(s.discountTotal),
      payments: s.payments,
      items: s._count.items,
      voidReason: s.voidReason,
    }));
  });

  app.get('/sales/:id', guard('reports'), async (req) => {
    const { id } = req.params as { id: string };
    const sale = await prisma.sale.findFirst({ where: { id, storeId: req.auth.sid }, include: { items: true } });
    if (!sale) throw notFound();
    return sale;
  });

  app.get('/cash-sessions', guard('reports'), async (req) => {
    const [sessions, names] = await Promise.all([
      prisma.cashSession.findMany({ where: { storeId: req.auth.sid }, orderBy: { openedAt: 'desc' }, take: 60 }),
      userNames(prisma, req.auth.sid),
    ]);
    const [moves, suppliers] = await Promise.all([
      prisma.cashMovement.findMany({ where: { cashSessionId: { in: sessions.map((s) => s.id) } }, orderBy: { occurredAt: 'asc' } }),
      prisma.supplier.findMany({ where: { storeId: req.auth.sid }, select: { id: true, name: true } }),
    ]);
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    return sessions.map((s) => ({
      ...s,
      user: names.get(s.userId) ?? null,
      movements: moves
        .filter((m) => m.cashSessionId === s.id)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          amount: num(m.amount),
          reason: m.reason,
          supplier: m.supplierId ? (supplierName.get(m.supplierId) ?? null) : null,
          user: names.get(m.userId) ?? null,
          occurredAt: m.occurredAt,
        })),
      movementsNet: round2(moves.filter((m) => m.cashSessionId === s.id).reduce((sum, m) => sum + cashMoveSign(m.kind as CashMoveKind) * num(m.amount), 0)),
      openingAmount: num(s.openingAmount),
      countedAmount: s.countedAmount == null ? null : num(s.countedAmount),
      expectedAmount: s.expectedAmount == null ? null : num(s.expectedAmount),
      difference: s.difference == null ? null : num(s.difference),
    }));
  });
}
