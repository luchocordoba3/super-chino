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
  gallery: z.array(z.object({ image: z.string().max(300), caption: z.string().max(140).default('') })).max(40).default([]),
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
  };
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
export const RESERVED_SLUGS = new Set(['api', 'panel', 'p', 'login', 'crear-cuenta', 'assets', 'demo', 'cuestionario', 'favicon.svg', 'manifest.webmanifest']);
