import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { CONDICION_IVA, emitFacturaC } from '../services/arca';

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/invoices', guard('cash'), async (req) =>
    prisma.invoice.findMany({ where: { businessId: req.auth.bid, date: { gte: new Date(Date.now() - 400 * 86_400_000) } }, orderBy: { date: 'desc' }, take: 300 }),
  );

  /** Emite la factura C en ARCA (desde un cobro o suelta). */
  app.post('/invoices/arca', guard('owner', 'arca'), async (req) => {
    const body = z
      .object({
        paymentId: z.string().nullish(),
        quoteId: z.string().nullish(),
        amount: z.number().finite().positive().max(1e12),
        concepto: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
        docTipo: z.union([z.literal(99), z.literal(80), z.literal(96)]).default(99),
        docNro: z.string().trim().max(20).default('0'),
        condicionIva: z.number().int().default(CONDICION_IVA.CONSUMIDOR_FINAL),
        customerName: z.string().trim().max(120).default(''),
      })
      .parse(req.body);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    const payment = body.paymentId ? await prisma.payment.findFirst({ where: { id: body.paymentId, businessId: b.id } }) : null;
    if (body.paymentId && !payment) throw notFound();
    if (payment?.invoiceId) throw badRequest('already_invoiced', 'Ese cobro ya tiene factura');
    const r = await emitFacturaC(b, { amount: body.amount, concepto: body.concepto, docTipo: body.docTipo, docNro: body.docNro, condicionIva: body.condicionIva });
    const inv = await prisma.invoice.create({
      data: {
        businessId: b.id,
        quoteId: body.quoteId ?? payment?.quoteId ?? null,
        paymentId: payment?.id ?? null,
        ptoVta: r.ptoVta,
        number: r.number,
        cae: r.cae,
        caeDue: r.caeDue,
        amount: body.amount,
        date: r.date,
        docType: body.docTipo,
        docNumber: body.docNro,
        customerName: body.customerName,
      },
    });
    if (payment) await prisma.payment.update({ where: { id: payment.id }, data: { invoiceId: inv.id } });
    return inv;
  });

  /** Factura hecha por fuera (en la web de ARCA o con otro sistema), para que cuente en el tope. */
  app.post('/invoices/manual', guard('cash'), async (req) => {
    const body = z
      .object({
        ptoVta: z.number().int().min(1).max(99999),
        number: z.number().int().min(1),
        date: z.string().datetime({ offset: true }),
        amount: z.number().finite().positive().max(1e12),
        customerName: z.string().trim().max(120).default(''),
        paymentId: z.string().nullish(),
      })
      .parse(req.body);
    const inv = await prisma.invoice.create({ data: { ...body, date: new Date(body.date), paymentId: body.paymentId ?? null, businessId: req.auth.bid, manual: true } });
    if (body.paymentId) await prisma.payment.updateMany({ where: { id: body.paymentId, businessId: req.auth.bid }, data: { invoiceId: inv.id } });
    return inv;
  });

  app.delete('/invoices/:id', guard('cash'), async (req) => {
    const { id } = req.params as { id: string };
    const inv = await prisma.invoice.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!inv) throw notFound();
    if (!inv.manual) throw badRequest('arca_invoice', 'Las facturas emitidas en ARCA no se borran: se anulan con una nota de crédito');
    await prisma.payment.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await prisma.invoice.delete({ where: { id } });
    return { ok: true };
  });
}
