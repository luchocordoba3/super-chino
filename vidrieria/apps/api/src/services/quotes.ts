import { randomBytes } from 'node:crypto';
import { Prisma, type Business, type Quote } from '@prisma/client';
import { calcQuote, type QuoteBody, type QuoteInput, type QuoteResult, type QuoteSettings } from '@vidrieria/shared';
import { num, prisma } from '../db';
import { badRequest, notFound } from '../lib/http';
import { dollarFor } from './dollar';
import { quoteSettings } from './settings';

const DAY = 86_400_000;
const LETTERS = ['A', 'B', 'C'];

/** Opción guardada en Quote.options. */
export interface StoredOption {
  label: string;
  input: QuoteInput;
  result: QuoteResult;
}

/** Una o varias opciones; flete, urgencia y ajuste son los mismos para todas. */
function toInputs(body: QuoteBody): { label: string; input: QuoteInput }[] {
  const shared = { freightKm: body.freightKm, urgent: body.urgent, adjustPct: body.adjustPct };
  if (body.options?.length) {
    return body.options.map((o, i) => ({
      label: o.label || `Opción ${LETTERS[i]}`,
      input: { items: o.items, extras: o.extras, discount: o.discount, ...shared },
    }));
  }
  return [{ label: '', input: { items: body.items, extras: body.extras, discount: body.discount, ...shared } }];
}

export function isEmptyBody(body: QuoteBody) {
  return toInputs(body).some(({ input }) => !input.items.length && !input.extras.length);
}

/** Calcula todas las opciones; los campos principales del presupuesto son los de la elegida (o la primera). */
function calcAll(inputs: { label: string; input: QuoteInput }[], settings: QuoteSettings, chosen: number | null = null) {
  const options: StoredOption[] = inputs.map((o) => ({ ...o, result: calcQuote(o.input, settings) }));
  const main = options[chosen ?? 0] ?? options[0];
  return {
    options: options.length > 1 ? options : null,
    input: main.input,
    result: main.result,
  };
}

const optionsData = (options: StoredOption[] | null) => (options ? (options as unknown as Prisma.InputJsonValue) : Prisma.DbNull);

export const storedOptions = (q: Pick<Quote, 'options'>) => (q.options as unknown as StoredOption[] | null) ?? null;

async function checkRefs(bid: string, body: QuoteBody) {
  if (body.customerId && !(await prisma.customer.findFirst({ where: { id: body.customerId, businessId: bid } }))) throw badRequest('customer_not_found');
  if (body.leadId && !(await prisma.lead.findFirst({ where: { id: body.leadId, businessId: bid } }))) throw badRequest('lead_not_found');
}

/** Calcula con la configuración actual de la vidriería (dólar del día incluido). */
export async function compute(b: Business, body: QuoteBody) {
  const dollar = await dollarFor(b);
  const settings = quoteSettings(b, dollar.rate);
  return { settings, ...calcAll(toInputs(body), settings) };
}

export async function createQuote(b: Business, uid: string, body: QuoteBody, extra: { photoIds?: string[]; noPriceTest?: boolean } = {}) {
  await checkRefs(b.id, body);
  // Prueba de precio: la mitad de los presupuestos nuevos sale con el recargo de prueba.
  const testPct = num(b.priceTestPct);
  const priceVariant = testPct > 0 && !extra.noPriceTest ? (Math.random() < 0.5 ? 'A' : 'B') : null;
  if (priceVariant === 'B') body = { ...body, adjustPct: body.adjustPct + testPct };
  const { input, settings, result, options } = await compute(b, body);
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
        options: optionsData(options),
        total: result.total,
        deposit: result.deposit,
        dollarRate: settings.dollarRate,
        validUntil: new Date(Date.now() + validDays * DAY),
        publicToken: randomBytes(18).toString('base64url'),
        photoIds: extra.photoIds ?? [],
        priceVariant,
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
  const { input, result, options } = calcAll(toInputs(body), settings);
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
      options: optionsData(options),
      chosenOption: null,
      total: result.total,
      deposit: result.deposit,
      dollarRate: settings.dollarRate,
      validUntil: new Date(Date.now() + validDays * DAY),
      status: q.status === 'EXPIRED' ? 'SENT' : q.status,
    },
  });
}

/** Opciones guardadas o la única, listas para recalcular. */
function inputsOf(q: Quote) {
  return storedOptions(q)?.map(({ label, input }) => ({ label, input })) ?? [{ label: '', input: q.input as unknown as QuoteInput }];
}

/** Total que tendría hoy con otro dólar (misma configuración congelada). */
export function totalWithDollar(q: Quote, dollarRate: number) {
  const s = { ...(q.settings as unknown as QuoteSettings), dollarRate };
  return calcQuote(inputsOf(q)[q.chosenOption ?? 0]?.input ?? (q.input as unknown as QuoteInput), s).total;
}

/** Pasa el presupuesto (todas sus opciones) al dólar de hoy y renueva la validez. Mismo link. */
export async function redollarQuote(b: Business, id: string) {
  const q = await prisma.quote.findFirst({ where: { id, businessId: b.id } });
  if (!q) throw notFound();
  if (q.status === 'ACCEPTED') throw badRequest('quote_accepted', 'El presupuesto ya fue aceptado');
  const dollar = await dollarFor(b);
  const settings = { ...(q.settings as unknown as QuoteSettings), dollarRate: dollar.rate };
  const { input, result, options } = calcAll(inputsOf(q), settings);
  return prisma.quote.update({
    where: { id },
    data: {
      input: input as object,
      settings: settings as object,
      result: result as object,
      options: optionsData(options),
      total: result.total,
      deposit: result.deposit,
      dollarRate: settings.dollarRate,
      validUntil: new Date(Date.now() + b.validDays * DAY),
      status: q.status === 'EXPIRED' ? 'SENT' : q.status,
    },
    include: { customer: true },
  });
}

/** Al aceptar: si tiene opciones, la elegida pasa a ser el presupuesto. */
export function acceptData(q: Quote, option: number | null | undefined) {
  const opts = storedOptions(q);
  const base = { status: 'ACCEPTED' as const, acceptedAt: q.acceptedAt ?? new Date(), rejectedAt: null, sentAt: q.sentAt ?? new Date() };
  if (!opts) return base;
  const i = option ?? 0;
  const o = opts[i];
  if (!o) throw badRequest('bad_option', 'Esa opción no existe');
  return { ...base, chosenOption: i, input: o.input as object, result: o.result as object, total: o.result.total, deposit: o.result.deposit };
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

/** Detalle para el cliente: sin precios unitarios ni costos. */
function publicResult(r: QuoteResult) {
  return {
    items: r.items.map((i) => ({
      title: i.title,
      ...(i.riskZone ? { riskZone: true } : {}),
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
    deposit: r.deposit,
    balance: r.balance,
  };
}

/** Lo que ve el cliente en el link: sin costos ni configuración interna. */
export function publicQuote(q: Quote & { customer: { name: string } | null }, b: Business) {
  const s = q.settings as unknown as QuoteSettings;
  const opts = storedOptions(q);
  return {
    number: q.number,
    title: q.title,
    notes: q.notes,
    status: q.status,
    customerName: q.customer?.name ?? null,
    createdAt: q.createdAt,
    validUntil: q.validUntil,
    acceptedAt: q.acceptedAt,
    ...publicResult(q.result as unknown as QuoteResult),
    /** Para elegir: solo mientras no aceptó. */
    options: opts && q.chosenOption == null ? opts.map((o) => ({ label: o.label, ...publicResult(o.result) })) : null,
    chosenLabel: opts && q.chosenOption != null ? (opts[q.chosenOption]?.label ?? null) : null,
    pricesIncludeVat: s.pricesIncludeVat,
    depositPct: s.depositPct,
    depositReportedAt: q.depositReportedAt,
    depositPaidAt: q.depositPaidAt,
    safetyAckAt: q.safetyAckAt,
    renders: q.renderUrls,
    footer: b.quoteFooter,
  };
}

/** Formato para la aseguradora: el detalle con cantidades y precios unitarios, más los datos del siniestro. */
export function insuranceDetail(q: Quote) {
  if (!q.insurance) return null;
  const r = q.result as unknown as QuoteResult;
  return {
    claim: q.insurance,
    items: r.items.map((i) => ({
      title: i.title,
      widthMm: i.widthMm,
      heightMm: i.heightMm,
      quantity: i.quantity,
      lines: i.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPriceArs, total: l.total })),
      total: i.total,
    })),
    extras: r.extras.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPriceArs, total: l.total })),
  };
}
