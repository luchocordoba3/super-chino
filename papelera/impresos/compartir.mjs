// Genera las imágenes para compartir (vista previa en WhatsApp, redes y buscadores), 1200×630.
// Una general y una por kit. Sin precios, para que no se desactualicen.
//   cd papelera/impresos && npm run compartir
import { build } from "../sitio/node_modules/esbuild/lib/main.js";
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITIO = join(AQUI, "../sitio");
const TMP = join(AQUI, ".tmp");
const SALIDA = join(SITIO, "public/compartir");
for (const d of [TMP, SALIDA]) mkdirSync(d, { recursive: true });

await build({
  stdin: { contents: 'export * from "./src/lib/catalogo.ts"; export * from "./src/lib/pictogramas.ts";', resolveDir: SITIO, loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: join(TMP, "datos.mjs"),
  define: { "import.meta.env": '{"PUBLIC_VISTA":"0"}' }, logLevel: "warning",
});
const { NEGOCIO, RUBROS, porCodigo, svgPictograma } = await import(pathToFileURL(join(TMP, "datos.mjs")).href);

const fuente = (p) => readFileSync(join(SITIO, "node_modules", p)).toString("base64");
const dominio = NEGOCIO.sitio.replace(/^https?:\/\//, "").replace(/\/$/, "");
const CSS = `
@font-face { font-family: "Archivo"; font-weight: 100 900; font-stretch: 62% 125%; src: url(data:font/woff2;base64,${fuente("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")}) format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 600; src: url(data:font/woff2;base64,${fuente("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2")}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #17288e; color: #fff; font-family: "Archivo", sans-serif; position: relative;
  background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); background-size: 40px 40px; }
.marca { position: absolute; left: 64px; top: 52px; display: flex; align-items: center; gap: 14px; }
.marca svg { width: 52px; height: 52px; }
.marca b { font-stretch: 72%; font-weight: 850; font-size: 34px; text-transform: uppercase; letter-spacing: .01em; }
.etq { font-family: "JetBrains Mono", monospace; font-weight: 600; font-size: 19px; letter-spacing: .1em; text-transform: uppercase; color: #f5c32c; }
h1 { font-stretch: 66%; font-weight: 880; text-transform: uppercase; line-height: .9; letter-spacing: -.005em; }
h1 span { color: #f5c32c; }
.texto { position: absolute; left: 64px; top: 150px; width: 640px; display: grid; gap: 22px; }
.pie { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: #f5c32c; color: #12141a; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  font-family: "JetBrains Mono", monospace; font-weight: 600; font-size: 21px; letter-spacing: .04em; }
.pie b { font-family: "Archivo"; font-stretch: 75%; font-weight: 850; font-size: 30px; letter-spacing: 0; text-transform: lowercase; }
.grilla { position: absolute; right: 64px; top: 64px; display: grid; grid-template-columns: repeat(2, 196px); gap: 14px; }
.caja { height: 150px; border-radius: 10px; display: grid; place-items: center; }
.caja svg, .grande svg { width: 62%; height: 62%; overflow: visible; }
svg.pic * { fill: none; stroke: #17288e; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
svg.pic .a { fill: #f5c32c; } svg.pic .p { fill: #17288e; stroke: none; } svg.pic .f { fill: #fff; }
.grande { position: absolute; right: 64px; top: 64px; width: 420px; height: 420px; border-radius: 18px; background: #fff; display: grid; place-items: center; }
.grande svg { width: 70%; height: 70%; }
.fila { display: flex; gap: 12px; margin-top: 8px; }
.fila div { width: 74px; height: 74px; border-radius: 8px; background: rgba(255,255,255,.12); display: grid; place-items: center; }
.fila svg { width: 70%; height: 70%; }
.fila svg.pic * { stroke: #fff; } .fila svg.pic .f { fill: #17288e; }
`;
const logo = `<svg viewBox="0 0 36 36"><rect x="11" y="2.5" width="19" height="25" rx="1.5" fill="#f5c32c" transform="rotate(9 20 15)"/><path d="M5 8h14.5l6.5 6.5V33H5z" fill="#fff"/><path d="M19.5 8v6.5H26" fill="none" stroke="#17288e" stroke-width="2" stroke-linejoin="round"/><path d="M9 20h12M9 24.5h12M9 29h7" stroke="#17288e" stroke-width="1.8" stroke-linecap="round" opacity=".55"/></svg>`;
const pagina = (cuerpo) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="marca">${logo}<b>${NEGOCIO.nombre}</b></div>${cuerpo}
  <div class="pie"><b>${dominio}</b><span>Precio por mayor · Reparto propio · ${NEGOCIO.zona}</span></div></body></html>`;

const TONOS = { quimicos: "#d9eef0", articulos: "#f1e6cf", bolsas: "#dcefd9", papel: "#e4e7fa", descartables: "#f6ddd6", embalaje: "#efe3cc" };
const piezas = [["compartir", pagina(`
  <div class="texto"><p class="etq">Distribuidora mayorista</p>
    <h1 style="font-size:92px">Todo lo que tu negocio gasta por semana, <span>en una entrega.</span></h1></div>
  <div class="grilla">${RUBROS.slice(0, 6).map((r) => `<div class="caja" style="background:${TONOS[r.id] || "#fff"}">${svgPictograma(r.icono, "pic")}</div>`).join("")}</div>`)]];

for (const k of NEGOCIO.kits) {
  const iconos = [...new Set(k.items.map(([c]) => porCodigo.get(c)?.icono).filter(Boolean))].slice(0, 6);
  const largo = k.rubro.length > 14;
  piezas.push([`kit-${k.id}`, pagina(`
    <div class="texto" style="top:132px;width:620px;gap:18px"><p class="etq">Kit inicial · ${k.items.length} artículos</p>
      <h1 style="font-size:${largo ? 80 : 100}px">Para tu <span>${k.rubro.toLowerCase()}</span></h1>
      <p style="font-size:25px;opacity:.85;line-height:1.3">${k.para}. Precio por mayor desde el primer pedido.</p>
      <div class="fila">${iconos.map((i) => `<div>${svgPictograma(i, "pic")}</div>`).join("")}</div></div>
    <div class="grande">${svgPictograma(k.icono, "pic")}</div>`)]);
}

const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
for (const [nombre, html] of piezas) {
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(SALIDA, `${nombre}.png`), type: "png" });
}
await navegador.close();
console.log(`${piezas.length} imágenes en sitio/public/compartir/`);
