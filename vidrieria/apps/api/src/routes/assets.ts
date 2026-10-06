import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';

const MAX_BYTES = 3 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
/** Comprobantes de seña: también PDF (lo que bajan de la app del banco). */
export const RECEIPT_MIMES = [...MIMES, 'application/pdf'];

/** "data:image/jpeg;base64,..." -> bytes. Las fotos llegan ya achicadas desde el navegador. */
export function decodeDataUrl(dataUrl: string, mimes = MIMES) {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m || !mimes.includes(m[1])) throw badRequest('bad_image', mimes.includes('application/pdf') ? 'El comprobante tiene que ser una foto o un PDF' : 'La foto tiene que ser JPG, PNG o WEBP');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_BYTES) throw badRequest('image_too_big', 'La foto es muy pesada');
  return { mime: m[1], data };
}

export async function assetRoutes(app: FastifyInstance) {
  app.post('/assets', guard(), async (req) => {
    // "quote": fotos de la medición, privadas.
    const body = z.object({ dataUrl: z.string().max(5 * 1024 * 1024), kind: z.enum(['site', 'logo', 'quote']) }).parse(req.body);
    const { mime, data } = decodeDataUrl(body.dataUrl);
    const a = await prisma.asset.create({ data: { businessId: req.auth.bid, mime, data, size: data.length, kind: body.kind, public: body.kind !== 'quote' } });
    return { id: a.id, url: `/api/assets/${a.id}` };
  });

  app.get('/assets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = await prisma.asset.findUnique({ where: { id } });
    if (!a) throw notFound();
    if (!a.public) {
      await authenticate(req);
      if (req.auth.bid !== a.businessId) throw notFound();
      reply.header('Cache-Control', 'private, max-age=3600');
    } else {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
    return reply.type(a.mime).send(a.data);
  });
}
