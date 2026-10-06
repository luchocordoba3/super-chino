import { PLAN_INFO, type PlanId, type QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/http';

/**
 * Foto "así quedaría": se le pasa la foto del cliente y un pedido, y la IA dibuja el trabajo en su lugar.
 * Lista para enchufar: se activa con IMAGE_API_KEY (Gemini). Cada foto cuesta unos centavos de dólar.
 */
export const renderEnabled = () => !!env.IMAGE_API_KEY;

export async function rendersThisMonth(bid: string) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return prisma.render.count({ where: { businessId: bid, createdAt: { gte: start }, status: 'DONE' } });
}

export async function renderQuota(bid: string, plan: PlanId) {
  return { enabled: renderEnabled(), used: await rendersThisMonth(bid), quota: PLAN_INFO[plan].renders };
}

/** Pedido para la IA a partir del trabajo del presupuesto. */
export function renderPrompt(item: QuoteResult['items'][number], extra = '') {
  const glass = item.lines.find((l) => l.applyWaste)?.name ?? 'vidrio';
  const hardware = item.lines.filter((l) => !l.applyWaste && /kit|herraje|bisagra|zócalo|pasamanos/i.test(l.name)).map((l) => l.name);
  return [
    `Editá esta foto: colocá una ${item.title.toLowerCase()} de ${glass.toLowerCase()} de ${Math.round(item.widthMm / 10)} × ${Math.round(item.heightMm / 10)} cm en el lugar que corresponde.`,
    hardware.length ? `Lleva ${hardware.join(', ').toLowerCase()}.` : '',
    'Que se vea fotorrealista, con la misma luz, perspectiva y ambiente. No cambies nada más de la foto.',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Llama a Gemini con la foto y devuelve la imagen generada. */
export async function generateRender(photo: { mime: string; data: Buffer }, prompt: string) {
  if (!env.IMAGE_API_KEY) throw new HttpError(503, 'render_off', 'Las fotos con IA se activan pronto');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.IMAGE_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.IMAGE_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: photo.mime, data: photo.data.toString('base64') } }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new HttpError(502, 'render_error', `No se pudo generar la foto: ${json.error?.message ?? res.status}`);
  for (const p of json.candidates?.[0]?.content?.parts ?? []) {
    const img = p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : null);
    if (img?.data) return { mime: img.mimeType, data: Buffer.from(img.data, 'base64') };
  }
  throw new HttpError(502, 'render_error', 'La IA no devolvió una imagen. Probá con otra foto.');
}
