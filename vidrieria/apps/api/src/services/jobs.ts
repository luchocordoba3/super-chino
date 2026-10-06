import { randomBytes } from 'node:crypto';
import type { JobStatus, Prisma } from '@prisma/client';
import type { QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';

const token = () => randomBytes(15).toString('base64url');

/** Lleva vidrio que se fabrica a medida (templado, laminado o DVH): tarda más que el cortado. */
export function needsFactory(r: QuoteResult) {
  return [...r.items.flatMap((i) => i.lines), ...r.extras].some((l) => l.applyWaste && /templad|laminad|dvh/i.test(l.name));
}

/** Suma días hábiles (saltea sábados y domingos). */
export function addBusinessDays(from: Date, days: number) {
  const d = new Date(from);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** Crea el trabajo de un presupuesto aceptado (si no existe). */
export async function ensureJob(quoteId: string, tx: Prisma.TransactionClient = prisma) {
  const existing = await tx.job.findUnique({ where: { quoteId } });
  if (existing) return existing;
  const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { customer: true, business: true } });
  return tx.job.create({
    data: {
      businessId: q.businessId,
      quoteId,
      address: q.customer?.address ?? '',
      needsFactory: needsFactory(q.result as unknown as QuoteResult),
      warrantyMonths: q.business.warrantyMonths,
      crewToken: token(),
      warrantyToken: token(),
    },
  });
}

export const JOB_ORDER: JobStatus[] = ['PENDING', 'ORDERED', 'MAKING', 'RECEIVED', 'SCHEDULED', 'INSTALLED', 'CLOSED'];

/** Descuenta del stock lo que llevó el trabajo (una sola vez, al colocarlo). */
export async function useStock(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { quote: true } });
  if (job.stockUsedAt) return;
  const r = job.quote.result as unknown as QuoteResult;
  const used = new Map<string, number>();
  for (const l of [...r.items.flatMap((i) => i.lines), ...r.extras]) {
    if (l.catalogItemId && !l.applyWaste) used.set(l.catalogItemId, (used.get(l.catalogItemId) ?? 0) + l.qty);
  }
  const tracked = await prisma.catalogItem.findMany({ where: { id: { in: [...used.keys()] }, businessId: job.businessId, stockQty: { not: null } } });
  await prisma.$transaction([
    ...tracked.map((c) => prisma.catalogItem.update({ where: { id: c.id }, data: { stockQty: { decrement: used.get(c.id)! } } })),
    prisma.job.update({ where: { id: jobId }, data: { stockUsedAt: new Date() } }),
  ]);
}

/** Cambia el estado y completa las fechas que corresponden. */
export async function setJobStatus(jobId: string, status: JobStatus) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { business: true } });
  const now = new Date();
  const data: Prisma.JobUpdateInput = { status };
  if (status === 'ORDERED' && !job.orderedAt) {
    data.orderedAt = now;
    data.promisedAt = addBusinessDays(now, job.needsFactory ? job.business.temperDays : job.business.glassDays);
  }
  if (status === 'RECEIVED' && !job.receivedAt) data.receivedAt = now;
  if (status === 'INSTALLED' && !job.installedAt) data.installedAt = now;
  if (status === 'CLOSED' && !job.closedAt) data.closedAt = now;
  const updated = await prisma.job.update({ where: { id: jobId }, data });
  if (status === 'INSTALLED' || status === 'CLOSED') await useStock(jobId);
  return updated;
}
