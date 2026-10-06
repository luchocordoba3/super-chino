import type { Business } from '@prisma/client';
import { z } from 'zod';

/** Contenido editable de la web pública de cada vidriería. Las imágenes son URLs (/api/assets/:id o /demo/...). */
export const siteSchema = z.object({
  headline: z.string().max(140).default(''),
  subheadline: z.string().max(400).default(''),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1d4ed8'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#dc2626'),
  heroImage: z.string().max(300).nullish(),
  services: z.array(z.object({ title: z.string().max(80), text: z.string().max(300), image: z.string().max(300).nullish() })).max(16).default([]),
  /** Fotos de trabajos, con el tipo de trabajo y el barrio (para mostrar trabajos parecidos y páginas por servicio). */
  gallery: z
    .array(z.object({ image: z.string().max(300), caption: z.string().max(140).default(''), kind: z.string().max(80).default(''), zone: z.string().max(80).default('') }))
    .max(60)
    .default([]),
  steps: z.array(z.object({ title: z.string().max(80), text: z.string().max(300) })).max(6).default([]),
  faqs: z.array(z.object({ q: z.string().max(200), a: z.string().max(800) })).max(20).default([]),
  /** Muestra "Imágenes ilustrativas" mientras no estén las fotos reales. */
  illustrativeImages: z.boolean().default(false),
});
export type SiteContent = z.infer<typeof siteSchema>;

export function siteContent(b: Pick<Business, 'site'>): SiteContent {
  const parsed = siteSchema.safeParse(b.site ?? {});
  return parsed.success ? parsed.data : siteSchema.parse({});
}

/** Lo que ve cualquiera en la web pública (nada de precios ni configuración interna). */
export function publicBusiness(b: Business) {
  return {
    slug: b.slug,
    name: b.name,
    whatsapp: b.whatsapp,
    email: b.email,
    address: b.address,
    zones: b.zones,
    hours: b.hours,
    instagram: b.instagram,
    logo: b.logoAssetId ? `/api/assets/${b.logoAssetId}` : null,
    site: siteContent(b),
    storm: stormOn(b),
  };
}

/** Modo tormenta: cartel de urgencias en la web. Se apaga solo a las 48 horas. */
export const stormOn = (b: Pick<Business, 'stormMode' | 'stormUntil'>) => b.stormMode && (!b.stormUntil || b.stormUntil.getTime() > Date.now());

/** "Mampara de baño" -> "mampara-de-bano" (para las páginas por servicio). */
export const serviceSlug = (title: string) => slugify(title);

/** Fotos de la galería que corresponden a un tipo de trabajo (por palabras clave del título). */
export function similarWork(site: SiteContent, title: string, max = 3) {
  const key = (t: string) => {
    const s = t.toLowerCase();
    return ['mampara', 'box', 'baranda', 'escalera', 'espejo', 'dvh', 'cerramiento', 'frente', 'puerta', 'cambio', 'vidrio'].find((k) => s.includes(k)) ?? s.split(' ')[0];
  };
  const k = key(title);
  return site.gallery.filter((g) => key(g.kind || g.caption).includes(k) || (g.kind || g.caption).toLowerCase().includes(k)).slice(0, max);
}

/** Slug para la URL a partir del nombre: "Cristales Ariel" -> "cristales-ariel". */
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'vidrieria'
  );
}

/** Rutas de la app que no pueden ser slug de una vidriería. */
export const RESERVED_SLUGS = new Set(['api', 'panel', 'p', 'o', 'g', 'qr', 'oferta', 'servicios', 'login', 'crear-cuenta', 'assets', 'demo', 'cuestionario', 'favicon.svg', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png']);
