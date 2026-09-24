import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { prisma } from '../db';
import { can, guard } from '../lib/auth';
import { badRequest, HttpError, notFound } from '../lib/http';
import { fileUrl, openImage, saveImage } from '../lib/uploads';
import { afterCreate, createMessage, translateAndNotify } from '../services/messages';
import { publish, subscribe } from '../services/notify';
import { consumeStock } from '../services/stock';
import { resolveAlert } from '../services/alerts';
import { storeCtx, userNames } from '../services/store';

type Meta = { type?: 'REMOVE_EXPIRED' | 'COUNT'; lotIds?: string[]; countId?: string } | null;

export async function messageRoutes(app: FastifyInstance) {
  /** El dueño manda a todos o a quien elija; un empleado le escribe al dueño. */
  app.post('/messages', guard(), async (req) => {
    const b = z
      .object({
        text: z.string().trim().min(1).max(2000),
        to: z.union([z.literal('all'), z.literal('owner'), z.array(z.string()).min(1)]),
        kind: z.enum(['MESSAGE', 'TASK']).default('MESSAGE'),
        requiresPhoto: z.boolean().default(false),
        dueAt: z.iso.datetime().nullish(),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    const users = await prisma.user.findMany({ where: { storeId, active: true, id: { not: req.auth.uid } }, select: { id: true, role: true } });
    let recipientIds: string[];
    if (b.to === 'owner') recipientIds = users.filter((u) => u.role === 'OWNER').map((u) => u.id);
    else if (!can(req.auth, 'owner')) throw new HttpError(403, 'employees_write_to_owner');
    else if (b.to === 'all') recipientIds = users.filter((u) => u.role === 'EMPLOYEE').map((u) => u.id);
    else recipientIds = users.filter((u) => (b.to as string[]).includes(u.id)).map((u) => u.id);
    if (recipientIds.length === 0) throw badRequest('no_recipients');
    const { message, needsTranslation } = await createMessage(prisma, {
      storeId,
      fromUserId: req.auth.uid,
      text: b.text,
      lang: req.auth.lang,
      kind: b.kind,
      recipientIds,
      requiresPhoto: b.kind === 'TASK' && b.requiresPhoto,
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
    });
    afterCreate(storeId, message.id, needsTranslation);
    return { id: message.id };
  });

  app.get('/messages', guard(), async (req) => {
    const { box } = z.object({ box: z.enum(['inbox', 'sent']).default('inbox') }).parse(req.query);
    const storeId = req.auth.sid;
    const where =
      box === 'inbox'
        ? { storeId, recipients: { some: { userId: req.auth.uid } } }
        : can(req.auth, 'owner')
          ? { storeId, OR: [{ fromUserId: req.auth.uid }, { fromUserId: null }] }
          : { storeId, fromUserId: req.auth.uid };
    const [msgs, names] = await Promise.all([
      prisma.message.findMany({ where, include: { recipients: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      userNames(prisma, storeId),
    ]);
    return msgs.map((m) => ({
      id: m.id,
      kind: m.kind,
      text: m.text,
      lang: m.lang,
      translations: m.translations,
      translationStatus: m.translationStatus,
      requiresPhoto: m.requiresPhoto,
      dueAt: m.dueAt,
      meta: m.meta,
      createdAt: m.createdAt,
      from: m.fromUserId ? { id: m.fromUserId, name: names.get(m.fromUserId) ?? '' } : null,
      doneAt: m.doneAt,
      doneBy: m.doneBy ? names.get(m.doneBy) ?? null : null,
      donePhoto: fileUrl(m.donePhoto),
      doneNote: m.doneNote,
      myReadAt: m.recipients.find((r) => r.userId === req.auth.uid)?.readAt ?? null,
      recipients: m.recipients.map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? '', readAt: r.readAt })),
    }));
  });

  /** Para el globito del menú: mensajes sin leer + tareas abiertas. */
  app.get('/messages/unread', guard(), async (req) => {
    const [unread, openTasks] = await Promise.all([
      prisma.messageRecipient.count({ where: { userId: req.auth.uid, readAt: null } }),
      prisma.message.count({ where: { storeId: req.auth.sid, kind: 'TASK', doneAt: null, recipients: { some: { userId: req.auth.uid } } } }),
    ]);
    return { unread, openTasks };
  });

  app.post('/messages/:id/read', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.messageRecipient.updateMany({ where: { messageId: id, userId: req.auth.uid, readAt: null }, data: { readAt: new Date() } });
    if (r.count) {
      const m = await prisma.message.findUnique({ where: { id }, select: { fromUserId: true } });
      publish(req.auth.sid, 'messages', { id }, m?.fromUserId ? [m.fromUserId, req.auth.uid] : [req.auth.uid]);
    }
    return { ok: true };
  });

  app.post('/messages/:id/translate', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const m = await prisma.message.findFirst({ where: { id, storeId: req.auth.sid }, include: { recipients: { select: { userId: true } } } });
    if (!m) throw notFound();
    const involved = m.fromUserId === req.auth.uid || m.recipients.some((r) => r.userId === req.auth.uid);
    if (!involved && !can(req.auth, 'owner')) throw new HttpError(403, 'forbidden');
    await translateAndNotify(id);
    return { ok: true };
  });

  /** Marcar tarea hecha (multipart con foto opcional: primero el campo "note", después "photo"). */
  app.post('/messages/:id/done', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const storeId = req.auth.sid;
    const m = await prisma.message.findFirst({ where: { id, storeId, kind: 'TASK' }, include: { recipients: true } });
    if (!m) throw notFound();
    if (!m.recipients.some((r) => r.userId === req.auth.uid) && !can(req.auth, 'owner')) throw new HttpError(403, 'forbidden');
    if (m.doneAt) return { ok: true };
    const meta = m.meta as Meta;
    if (meta?.type === 'COUNT') throw badRequest('use_count_form');

    let note: string | null = null;
    let photo: string | null = null;
    if (req.isMultipart()) {
      const file: MultipartFile | undefined = await req.file();
      if (file) {
        const noteField = file.fields.note as { value?: string } | undefined;
        note = noteField?.value?.slice(0, 500) || null;
        const buf = await file.toBuffer();
        if (buf.length) photo = await saveImage(storeId, buf, file.mimetype);
      }
    } else {
      note = z.object({ note: z.string().max(500).nullish() }).parse(req.body ?? {}).note ?? null;
    }
    if (m.requiresPhoto && !photo) throw badRequest('photo_required');

    await prisma.$transaction(async (tx) => {
      if (meta?.type === 'REMOVE_EXPIRED' && meta.lotIds?.length) {
        const { today } = await storeCtx(tx, storeId);
        const lots = await tx.lot.findMany({ where: { storeId, id: { in: meta.lotIds }, qtyRemaining: { gt: 0 } } });
        for (const lot of lots) {
          await consumeStock(tx, { storeId, productId: lot.productId, lotId: lot.id, qty: Number(lot.qtyRemaining), today, type: 'WASTE', refId: m.id, userId: req.auth.uid, reason: 'vencido' });
          await resolveAlert(tx, storeId, `EXPIRED:${lot.id}`);
        }
      }
      await tx.message.update({ where: { id }, data: { doneAt: new Date(), doneBy: req.auth.uid, donePhoto: photo, doneNote: note } });
    });
    publish(storeId, 'messages', { id });
    if (meta?.type === 'REMOVE_EXPIRED') publish(storeId, 'stock');
    return { ok: true };
  });

  /** Fotos subidas (solo del propio local). */
  app.get('/files/*', guard(), async (req, reply) => {
    const rel = (req.params as { '*': string })['*'];
    const f = openImage(req.auth.sid, rel);
    if (!f) throw notFound();
    return reply.type(f.type).header('Cache-Control', 'private, max-age=86400').send(f.stream);
  });

  // ---------- Tiempo real y notificaciones ----------
  app.get('/events', guard(), async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': ok\n\n');
    const unsub = subscribe(req.auth.sid, {
      userId: req.auth.uid,
      send: (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  app.post('/push/subscribe', guard(), async (req) => {
    const b = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      create: { storeId: req.auth.sid, userId: req.auth.uid, endpoint: b.endpoint, keys: b.keys },
      update: { storeId: req.auth.sid, userId: req.auth.uid, keys: b.keys },
    });
    return { ok: true };
  });
}
