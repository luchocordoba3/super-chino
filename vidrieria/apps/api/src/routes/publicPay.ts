import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hasFeature } from '@vidrieria/shared';
import { num, prisma } from '../db';
import { HttpError, notFound } from '../lib/http';
import { money } from '../lib/text';
import { getPayment, mpToken, paymentLink } from '../services/mercadopago';
import { notifyLater } from '../services/push';
import { registerPayment } from './cash';

export async function publicPayRoutes(app: FastifyInstance) {
  /** El cliente paga la seña (o el saldo) con Mercado Pago desde el link del presupuesto. */
  app.post(
    '/public/quotes/:token/mp',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const { kind } = z.object({ kind: z.enum(['SENA', 'SALDO']).default('SENA') }).parse(req.body ?? {});
      const q = await prisma.quote.findUnique({ where: { publicToken: token }, include: { business: true, payments: true } });
      if (!q || !hasFeature(q.business.plan, 'mercadopago') || !mpToken(q.business)) throw notFound();
      if (q.status !== 'ACCEPTED') throw new HttpError(409, 'not_accepted', 'Primero aceptá el presupuesto.');
      const paid = q.payments.reduce((a, p) => a + num(p.amount), 0);
      const amount = kind === 'SENA' ? num(q.deposit) : num(q.total) - paid;
      if (amount <= 0) throw new HttpError(409, 'nothing_to_pay', 'No hay nada para pagar.');
      return { url: await paymentLink(q.business, q, kind, amount, `${req.protocol}://${req.hostname}`) };
    },
  );

  /** Aviso de Mercado Pago: se verifica el pago contra su API y se registra una sola vez. */
  app.post('/public/mp/:businessId', async (req, reply) => {
    const { businessId } = req.params as { businessId: string };
    const body = (req.body ?? {}) as { type?: string; topic?: string; data?: { id?: string | number } };
    const query = req.query as { id?: string; topic?: string; type?: string; 'data.id'?: string };
    const type = body.type ?? body.topic ?? query.type ?? query.topic;
    const id = String(body.data?.id ?? query['data.id'] ?? query.id ?? '');
    const b = await prisma.business.findUnique({ where: { id: businessId } });
    const token = b ? mpToken(b) : null;
    if (!b || !token || type !== 'payment' || !id) return reply.send({ ok: true });
    if (await prisma.payment.findUnique({ where: { mpPaymentId: id } })) return reply.send({ ok: true });

    const p = await getPayment(token, id);
    const [quoteId, kind] = (p.external_reference ?? '').split(':');
    const q = quoteId ? await prisma.quote.findFirst({ where: { id: quoteId, businessId }, include: { customer: true } }) : null;
    if (p.status !== 'approved' || !q) return reply.send({ ok: true });

    const amount = p.transaction_amount;
    const net = p.transaction_details?.net_received_amount ?? amount;
    await registerPayment(businessId, {
      quoteId: q.id,
      kind: kind === 'SALDO' ? 'SALDO' : 'SENA',
      method: 'MERCADOPAGO',
      amount,
      note: `Mercado Pago #${id}`,
      date: p.date_approved ?? undefined,
      mpPaymentId: id,
      feePct: amount ? Math.round((1 - net / amount) * 10_000) / 100 : 0,
      net,
    });
    notifyLater(businessId, {
      title: `${q.customer?.name ?? 'El cliente'} pagó con Mercado Pago`,
      body: `N° ${q.number} · ${kind === 'SALDO' ? 'saldo' : 'seña'} ${money(amount)}. Ya quedó en la caja.`,
      url: `/panel/presupuestos/${q.id}`,
    });
    return reply.send({ ok: true });
  });
}
