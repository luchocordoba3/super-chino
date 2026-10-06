import { randomBytes } from 'node:crypto';
import type { Business, Quote } from '@prisma/client';
import { calcQuote, type QuoteBody, type QuoteInput, type QuoteResult, type QuoteSettings } from '@vidrieria/shared';
import { num, prisma } from '../db';
import { badRequest, notFound } from '../lib/http';
import { dollarFor } from './dollar';
import { quoteSettings } from './settings';

const DAY = 86_400_000;

function toInput(body: QuoteBody): QuoteInput {
  return {
    items: body.items,
    extras: body.extras,
    freightKm: body.freightKm,
    urgent: body.urgent,
    adjustPct: body.adjustPct,
    discount: body.discount,
  };
}

async function checkRefs(bid: string, body: QuoteBody) {
  if (body.customerId && !(await prisma.customer.findFirst({ where: { id: body.customerId, businessId: bid } }))) throw badRequest('customer_not_found');
  if (body.leadId && !(await prisma.lead.findFirst({ where: { id: body.leadId, businessId: bid } }))) throw badRequest('lead_not_found');
}

/** Calcula con la configuración actual de la vidriería (dólar del día incluido). */
export async function compute(b: Business, body: QuoteBody) {
  const dollar = await dollarFor(b);
  const settings = quoteSettings(b, dollar.rate);
  const input = toInput(body);
  const result = calcQuote(input, settings);
  return { input, settings, result };
}

export async function createQuote(b: Business, uid: string, body: QuoteBody) {
  await checkRefs(b.id, body);
  const { input, settings, result } = await compute(b, body);
  const validDays = body.validDays ?? b.validDays;
  return prisma.$transaction(async (tx) => {
    const biz = await tx.business.update({ where: { id: b.id }, data: { nextQuoteNumber: { increment: 1 } }, select: { nextQuoteNumber: true } });
    const quote = await tx.quote.create({
      data: {
        businessId: b.id,
        number: biz.nextQuoteNumber - 1,
        customerId: body.customerId ?? null,
        leadId: body.leadId ?? null,
        title: body.title,
        notes: body.notes,
        input: input as object,
        settings: settings as object,
        result: result as object,
        total: result.total,
        deposit: result.deposit,
        dollarRate: settings.dollarRate,
        validUntil: new Date(Date.now() + validDays * DAY),
        publicToken: randomBytes(18).toString('base64url'),
        createdById: uid,
      },
    });
    if (body.leadId) await tx.lead.update({ where: { id: body.leadId }, data: { status: 'QUOTED', customerId: body.customerId ?? undefined } });
    return quote;
  });
}

/**
 * Edita un presupuesto. Se recalcula con la configuración actual; si ya estaba enviado,
 * el cliente ve la versión nueva en el mismo link.
 */
export async function updateQuote(b: Business, id: string, body: QuoteBody, recalcDollar: boolean) {
  const q = await prisma.quote.findFirst({ where: { id, businessId: b.id } });
  if (!q) throw notFound();
  if (q.status === 'ACCEPTED') throw badRequest('quote_accepted', 'El presupuesto ya fue aceptado');
  await checkRefs(b.id, body);
  const dollar = await dollarFor(b);
  const settings = quoteSettings(b, recalcDollar ? dollar.rate : num(q.dollarRate));
  const input = toInput(body);
  const result = calcQuote(input, settings);
  const validDays = body.validDays ?? b.validDays;
  return prisma.quote.update({
    where: { id },
    data: {
      customerId: body.customerId ?? null,
      title: body.title,
      notes: body.notes,
      input: input as object,
      settings: settings as object,
      result: result as object,
      total: result.total,
      deposit: result.deposit,
      dollarRate: settings.dollarRate,
      validUntil: new Date(Date.now() + validDays * DAY),
      status: q.status === 'EXPIRED' ? 'SENT' : q.status,
    },
  });
}

/** Vencido = enviado o visto y pasada la fecha de validez (se marca al leerlo). */
export async function expireIfNeeded<T extends Pick<Quote, 'id' | 'status' | 'validUntil'>>(q: T): Promise<T> {
  if ((q.status === 'SENT' || q.status === 'VIEWED') && q.validUntil.getTime() < Date.now()) {
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'EXPIRED' } });
    return { ...q, status: 'EXPIRED' };
  }
  return q;
}

export async function expireOld(bid: string) {
  await prisma.quote.updateMany({ where: { businessId: bid, status: { in: ['SENT', 'VIEWED'] }, validUntil: { lt: new Date() } }, data: { status: 'EXPIRED' } });
}

/** Lo que ve el cliente en el link: sin costos ni configuración interna. */
export function publicQuote(q: Quote & { customer: { name: string } | null }, b: Business) {
  const r = q.result as unknown as QuoteResult;
  const s = q.settings as unknown as QuoteSettings;
  return {
    number: q.number,
    title: q.title,
    notes: q.notes,
    status: q.status,
    customerName: q.customer?.name ?? null,
    createdAt: q.createdAt,
    validUntil: q.validUntil,
    acceptedAt: q.acceptedAt,
    items: r.items.map((i) => ({
      title: i.title,
      widthMm: i.widthMm,
      heightMm: i.heightMm,
      quantity: i.quantity,
      lines: i.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit })),
      total: i.total,
    })),
    extras: r.extras.map((l) => ({ name: l.name, total: l.total })),
    adjust: r.adjust,
    urgency: r.urgency,
    freight: r.freight,
    discount: r.discount,
    total: r.total,
    vat: r.vat,
    pricesIncludeVat: s.pricesIncludeVat,
    depositPct: s.depositPct,
    deposit: r.deposit,
    balance: r.balance,
    footer: b.quoteFooter,
  };
}
