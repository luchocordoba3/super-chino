import { NEGOCIO } from "../lib/catalogo";

export function GET() {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /q/\nSitemap: ${new URL("/sitemap.xml", NEGOCIO.sitio).href}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
