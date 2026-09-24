import type { Lang, MessageKind, Prisma } from '@prisma/client';
import { aiService } from '../ai';
import { prisma, type Db } from '../db';
import { publish, pushTo } from './notify';

export interface NewMessage {
  storeId: string;
  fromUserId: string | null;
  text: string;
  lang: Lang;
  kind?: MessageKind;
  recipientIds: string[];
  requiresPhoto?: boolean;
  dueAt?: Date | null;
  meta?: Prisma.InputJsonValue;
}

export async function recordAiUsage(storeId: string, feature: string, usage: { model: string; input: number; output: number }) {
  await prisma.aiUsage.create({ data: { storeId, feature, model: usage.model, inputTokens: usage.input, outputTokens: usage.output } });
}

/** Crea el mensaje. Si algún destinatario habla otro idioma, se traduce en segundo plano. */
export async function createMessage(db: Db, m: NewMessage) {
  const users = await db.user.findMany({ where: { storeId: m.storeId, id: { in: m.recipientIds }, active: true }, select: { id: true, lang: true } });
  const needs = users.some((u) => u.lang !== m.lang) && m.fromUserId !== null;
  const msg = await db.message.create({
    data: {
      storeId: m.storeId,
      fromUserId: m.fromUserId,
      text: m.text,
      lang: m.lang,
      kind: m.kind ?? 'MESSAGE',
      requiresPhoto: m.requiresPhoto ?? false,
      dueAt: m.dueAt ?? null,
      meta: m.meta,
      translationStatus: needs ? 'pending' : 'none',
      recipients: { create: users.map((u) => ({ userId: u.id })) },
    },
  });
  return { message: msg, needsTranslation: needs };
}

/** Traduce al idioma de cada destinatario y después avisa (push en su idioma). */
export async function translateAndNotify(messageId: string) {
  const m = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { recipients: true } });
  const users = await prisma.user.findMany({ where: { id: { in: m.recipients.map((r) => r.userId) } }, select: { id: true, lang: true } });
  const translations = { ...((m.translations as Record<string, string>) ?? {}) };
  let status = m.translationStatus;
  const targets = [...new Set(users.map((u) => u.lang))].filter((l) => l !== m.lang && !translations[l]);
  if (targets.length && m.fromUserId) {
    if (!aiService.enabled()) status = 'failed';
    else {
      try {
        for (const lang of targets) {
          const r = await aiService.translate(m.text, m.lang, lang);
          translations[lang] = r.data;
          await recordAiUsage(m.storeId, 'translate', r.usage);
        }
        status = 'done';
      } catch {
        status = 'failed';
      }
    }
    await prisma.message.update({ where: { id: m.id }, data: { translations, translationStatus: status } });
  }
  await notifyMessage(m.storeId, m.id);
}

/** Avisa a los destinatarios: pantalla en vivo + notificación en el celular, en el idioma de cada uno. */
export async function notifyMessage(storeId: string, messageId: string) {
  const m = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { recipients: true } });
  const ids = m.recipients.map((r) => r.userId);
  publish(storeId, 'messages', { id: m.id }, [...ids, ...(m.fromUserId ? [m.fromUserId] : [])]);
  const [users, from] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, lang: true } }),
    m.fromUserId ? prisma.user.findUnique({ where: { id: m.fromUserId }, select: { name: true } }) : null,
  ]);
  const translations = (m.translations as Record<string, string>) ?? {};
  for (const lang of ['es', 'zh'] as const) {
    const to = users.filter((u) => u.lang === lang).map((u) => u.id);
    const body = lang === m.lang ? m.text : (translations[lang] ?? m.text);
    const title = (from?.name ?? 'Super Chino') + (m.kind === 'TASK' ? (lang === 'zh' ? ' · 任务' : ' · Tarea') : '');
    await pushTo(to, { title, body: body.slice(0, 180), url: '/messages' });
  }
}

const jobs = new Set<Promise<unknown>>();

/** Lanza la traducción y los avisos sin frenar la respuesta. */
export function afterCreate(storeId: string, messageId: string, needsTranslation: boolean) {
  const job = new Promise((r) => setImmediate(r))
    .then(() => (needsTranslation ? translateAndNotify(messageId) : notifyMessage(storeId, messageId)))
    .catch((e) => console.error('mensaje', messageId, e));
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

/** Espera los trabajos en segundo plano (para tests). */
export const settleJobs = () => Promise.all([...jobs]);
