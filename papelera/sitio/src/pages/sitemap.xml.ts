import { NEGOCIO, PRODUCTOS } from "../lib/catalogo";

export function GET() {
  const caminos = ["", "lista", "pedido-rapido", "cuenta-mayorista", ...NEGOCIO.segmentos.map((s) => s.id), ...PRODUCTOS.map((p) => `producto/${p.codigo.toLowerCase()}`)];
  const urls = caminos.map((c) => `<url><loc>${new URL(c ? `/${c}/` : "/", NEGOCIO.sitio).href}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml" } });
}
