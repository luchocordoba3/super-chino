// Genera los impresos de Doble Hoja en PDF listos para imprenta (tamaño final + 3 mm de sangrado).
// Usa los mismos datos, pictogramas y tipografías que la web.
//   cd papelera/impresos && npm install && npx playwright install chromium && npm run generar
import { build } from "../sitio/node_modules/esbuild/lib/main.js";
import { chromium } from "playwright";
import QR from "qrcode";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITIO = join(AQUI, "../sitio");
const TMP = join(AQUI, ".tmp");
const SALIDA = join(AQUI, "pdf");
const PREVIAS = join(AQUI, "previas");
for (const d of [TMP, SALIDA, PREVIAS]) mkdirSync(d, { recursive: true });

// ---------- Datos de la web ----------
await build({
  stdin: { contents: 'export * from "./src/lib/catalogo.ts"; export * from "./src/lib/pictogramas.ts";', resolveDir: SITIO, loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: join(TMP, "datos.mjs"),
  define: { "import.meta.env": '{"PUBLIC_VISTA":"0"}' }, logLevel: "warning",
});
const { NEGOCIO, PRODUCTOS, porCodigo, pesos, totalKit, svgPictograma, RUBROS } = await import(pathToFileURL(join(TMP, "datos.mjs")).href);

const dominio = NEGOCIO.sitio.replace(/^https?:\/\//, "").replace(/\/$/, "");
const wa = NEGOCIO.whatsappVisible || NEGOCIO.whatsapp || "11 ____-____";
const hoy = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const mesAno = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
const reparto = NEGOCIO.reparto;

// ---------- Recursos ----------
const fuente = (p) => readFileSync(join(SITIO, "node_modules", p)).toString("base64");
const FUENTES = `
@font-face { font-family: "Archivo"; font-weight: 100 900; font-stretch: 62% 125%; src: url(data:font/woff2;base64,${fuente("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")}) format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url(data:font/woff2;base64,${fuente("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2")}) format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 600; src: url(data:font/woff2;base64,${fuente("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2")}) format("woff2"); }`;

const qrs = {};
async function qr(pieza) {
  const url = `${NEGOCIO.sitio}/q/${pieza}`;
  qrs[pieza] = url;
  const svg = await QR.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#12141a", light: "#ffffff" } });
  return `<div class="qr">${svg}</div>`;
}

const logo = (hoja = "#ffffff", pliegue = "#17288e") => `
<svg class="logo-iso" viewBox="0 0 36 36" aria-hidden="true">
  <rect x="11" y="2.5" width="19" height="25" rx="1.5" fill="#f5c32c" transform="rotate(9 20 15)"/>
  <path d="M5 8h14.5l6.5 6.5V33H5z" fill="${hoja}"/>
  <path d="M19.5 8v6.5H26" fill="none" stroke="${pliegue}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M9 20h12M9 24.5h12M9 29h7" stroke="${pliegue}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>
</svg>`;
const marca = (hoja, pliegue, bajada = true) => `<div class="marca">${logo(hoja, pliegue)}<div><b>${NEGOCIO.nombre}</b>${bajada ? `<span>${NEGOCIO.bajada}</span>` : ""}</div></div>`;
const pic = (n, clase = "pic") => svgPictograma(n, clase);
const iconoWa = `<svg class="ico-wa" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/></svg>`;
const cinta = (texto, veces = 6) => `<div class="cinta">${Array.from({ length: veces }, () => `<span>${texto}</span>`).join("")}</div>`;
const corto = (dias) => dias.replace("Lunes", "Lun").replace("Martes", "Mar").replace("Miércoles", "Mié").replace("jueves", "jue").replace("viernes", "vie").replace("sábados", "sáb");

const CSS = `${FUENTES}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Archivo", Arial, sans-serif; color: #12141a; }
.hoja { position: relative; overflow: hidden; break-after: page; background: #fff; }
.hoja:last-child { break-after: auto; }
.corte { position: absolute; inset: 3mm; }
.seguro { position: absolute; inset: 7mm; display: flex; flex-direction: column; }
.cobalto { background: #17288e; color: #fff; }
.amarillo { background: #f5c32c; color: #1c1600; }
.papel { background: #f2f3f6; }
.d { font-family: "Archivo"; font-stretch: 64%; font-weight: 880; text-transform: uppercase; line-height: .9; }
.m { font-family: "JetBrains Mono", monospace; }
.si { color: #f5c32c; }
.marca { display: flex; align-items: center; gap: 2mm; }
.marca b { display: block; font-stretch: 66%; font-weight: 880; text-transform: uppercase; line-height: 1; }
.marca span { display: block; opacity: .75; }
.logo-iso { flex: none; width: 2.3em; height: 2.3em; }
.qr { background: #fff; padding: 1.6mm; border-radius: 1mm; line-height: 0; }
.qr svg { width: 100%; height: auto; display: block; }
.pic { display: block; width: 100%; height: 100%; overflow: visible; }
.pic * { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.pic .a { fill: #f5c32c; } .pic .p { fill: currentColor; stroke: none; } .pic .f { fill: #fff; }
.cinta { position: absolute; left: -10mm; right: -10mm; background: #f5c32c; color: #1c1600; display: flex; gap: 6mm; align-items: center; white-space: nowrap; overflow: hidden; font-family: "JetBrains Mono"; text-transform: uppercase; letter-spacing: .12em; transform: rotate(-2.4deg); }
.ico-wa { width: 1em; height: 1em; vertical-align: -.12em; }
.etq { font-family: "JetBrains Mono"; text-transform: uppercase; letter-spacing: .08em; }
.sticker-precio { background: #f5c32c; color: #1c1600; font-family: "JetBrains Mono"; font-weight: 600; padding: .3mm 1mm; border-radius: .6mm; white-space: nowrap; }
.tono-quimicos { background: #d8eeee; } .tono-articulos { background: #efe6d3; } .tono-bolsas { background: #dcedda; }
.tono-papel { background: #e1e7f8; } .tono-descartables { background: #f6dfd9; } .tono-embalaje { background: #ecdfca; }
.linea { border-bottom: .25mm solid #12141a; }
.punteado { border-bottom: .2mm dashed #b9bdc8; }
`;

// ---------- Piezas ----------
const PIEZAS = [];
const pieza = (archivo, ancho, alto, paginas, nota) => PIEZAS.push({ archivo, ancho, alto, paginas, nota });
const hoja = (ancho, alto, clase, html) => `<section class="hoja ${clase}" style="width:${ancho + 6}mm;height:${alto + 6}mm">${html}</section>`;

// Imán de heladera 60×90
pieza("01-iman-heladera-60x90", 60, 90, [hoja(60, 90, "cobalto", `
  <div class="seguro" style="gap:3mm;inset:7mm 7mm 11.5mm">
    <div style="font-size:3.4mm">${marca("#fff", "#17288e", false).replace("<b>", '<b style="font-size:5.2mm">')}</div>
    <h1 class="d" style="font-size:9.6mm;margin-top:1.5mm">¿Se te<br>terminaron<br><span class="si">las bolsas?</span></h1>
    <p style="font-size:2.9mm;line-height:1.3;opacity:.9">Bolsas, servilletas, descartables y limpieza con precio por mayor. Te lo llevamos.</p>
    <p class="m si" style="font-size:5.2mm;font-weight:600;white-space:nowrap">${iconoWa} ${wa}</p>
    <div style="margin-top:auto;display:flex;gap:2.5mm;align-items:flex-end">
      <div style="width:19mm">${await qr("iman")}</div>
      <p style="font-size:2.6mm;line-height:1.3;padding-bottom:1mm">Escaneá y mirá la<br><b>lista de precios</b></p>
    </div>
  </div>
  <div class="cinta" style="bottom:2.2mm;height:4.2mm;font-size:1.9mm">${["Reparto propio", NEGOCIO.zona, "Precio por mayor"].join(" · ")}</div>`)]);

// Sticker de reposición 80×80
pieza("02-sticker-reposicion-80x80", 80, 80, [hoja(80, 80, "amarillo", `
  <div class="seguro" style="gap:2.5mm">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="font-size:3.2mm">${marca("#12141a", "#f5c32c", false).replace("<b>", '<b style="font-size:4.6mm">')}</div>
      <div style="display:flex;gap:1.2mm;width:22mm;color:#12141a">${["bolsa", "rollo", "bidon"].map((n) => `<div style="width:7mm;height:7mm">${pic(n)}</div>`).join("")}</div>
    </div>
    <h1 class="d" style="font-size:15mm;margin-top:1mm">¿Se<br>terminó?</h1>
    <div style="margin-top:auto;display:flex;gap:3.5mm;align-items:flex-end">
      <div style="width:28mm">${await qr("sticker")}</div>
      <div style="display:grid;gap:1.6mm;padding-bottom:.5mm">
        <p class="d" style="font-size:6.4mm">Pedilo acá</p>
        <p style="font-size:2.7mm;line-height:1.3">Escaneá el código o escribinos:</p>
        <p class="m" style="font-size:4mm;font-weight:600;white-space:nowrap">${iconoWa} ${wa}</p>
        <p class="m" style="font-size:2.3mm">${dominio}</p>
      </div>
    </div>
  </div>`)]);

// Ficha A5 doble faz
const bulto = ["LB0003", "LL0228", "PV0007", "LT0045", "PS0004", "LP0114"].map((c) => porCodigo.get(c));
const destacados = NEGOCIO.destacados.map((c) => porCodigo.get(c)).filter(Boolean);
pieza("03-ficha-A5-doble-faz", 148, 210, [
  hoja(148, 210, "", `
  <div class="cobalto" style="position:absolute;left:0;right:0;top:0;height:117mm"></div>
  <div class="seguro" style="inset:10mm 11mm">
    <div style="font-size:3.6mm">${marca("#fff", "#17288e").replace("<b>", '<b style="font-size:7mm;color:#fff">').replace("<span>", '<span style="color:#fff;margin-top:1mm">')}</div>
    <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:6mm;margin-top:9mm;align-items:end;color:#fff">
      <h1 class="d" style="font-size:12.2mm">Todo lo que tu negocio gasta por semana, <span class="si">en una entrega.</span></h1>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.4mm;transform:rotate(-2deg)">
        ${bulto.map((p) => `<div class="tono-${p.rubroId}" style="aspect-ratio:1;border-radius:.8mm;padding:1.6mm;color:#17288e;display:grid;grid-template-rows:1fr auto"><div style="width:70%;margin:auto">${pic(p.icono)}</div><b class="d" style="font-size:2.6mm;color:#12141a;text-align:right">${p.medida}</b></div>`).join("")}
      </div>
    </div>
    <p style="color:#fff;font-size:3.3mm;line-height:1.4;margin-top:6mm;max-width:100mm;opacity:.92">Bolsas, papel, descartables y químicos de limpieza con precio por mayor publicado. Pedís por WhatsApp o en la web y te lo lleva nuestra camioneta.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4mm 6mm;margin-top:16mm">
      ${[["Precio publicado", "Toda la lista a la vista: sabés el total antes de pedir."], ["Reparto propio", "Día fijo por zona, dos veces por semana."], [`Por mayor desde ${pesos(NEGOCIO.minimoMayorista)}`, "Se aplica solo a todo el pedido."], ["Factura en cada entrega", "Con el detalle de cada artículo."]].map(([t, d]) => `<div style="border-top:.5mm solid #12141a;padding-top:1.8mm"><p class="d" style="font-size:4.4mm">${t}</p><p style="font-size:2.8mm;color:#585d6c;margin-top:1mm;line-height:1.35">${d}</p></div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2mm;margin-top:7mm">
      ${RUBROS.map((r) => `<div style="display:grid;gap:1.2mm;justify-items:center;text-align:center"><div class="tono-${r.id}" style="width:13mm;height:13mm;border-radius:1mm;padding:2mm;color:#17288e">${pic(r.icono)}</div><span class="d" style="font-size:2.5mm">${r.corto}</span></div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;gap:5mm;align-items:flex-end;justify-content:space-between">
      <div style="display:grid;gap:1.5mm">
        <p class="etq" style="font-size:2.3mm;color:#585d6c">Pedidos y consultas</p>
        <p class="m" style="font-size:6mm;font-weight:600;white-space:nowrap">${iconoWa} ${wa}</p>
        <p style="font-size:3mm">Lista completa con precios en <b>${dominio}</b></p>
        <p style="font-size:2.6mm;color:#585d6c">${NEGOCIO.horario}</p>
      </div>
      <div style="width:27mm;flex:none;border:.3mm solid #d9dce4;border-radius:1.2mm">${await qr("ficha")}</div>
    </div>
  </div>
  <div class="cinta" style="top:113mm;height:6mm;font-size:2.4mm">${[NEGOCIO.nombre, "Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")} · ${[NEGOCIO.nombre, "Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")}</div>`),
  hoja(148, 210, "", `
  <div class="seguro" style="inset:10mm 11mm">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.6mm solid #12141a;padding-bottom:2.5mm">
      <div><p class="etq" style="font-size:2.3mm;color:#585d6c">Lista de precios · ${mesAno}</p><h2 class="d" style="font-size:8.6mm;margin-top:1.2mm">Los 20 más pedidos</h2></div>
      <div style="font-size:2.8mm;color:#12141a">${marca("#17288e", "#fff", false).replace("<b>", '<b style="font-size:4mm">')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:1.5mm;font-size:2.65mm">
      <thead><tr class="etq" style="font-size:1.9mm;color:#585d6c;text-align:left"><th style="padding:1.6mm 0;width:7mm"></th><th>Código</th><th>Artículo</th><th style="text-align:right">Por mayor</th><th style="text-align:right">Suelto</th></tr></thead>
      <tbody>${destacados.map((p) => `<tr class="punteado"><td style="padding:.9mm 0"><div class="tono-${p.rubroId}" style="width:5.4mm;height:5.4mm;border-radius:.6mm;padding:.7mm;color:#17288e">${pic(p.icono)}</div></td><td class="m" style="font-size:2.2mm;color:#585d6c;padding-right:2mm">${p.codigo}</td><td style="padding-right:2mm;line-height:1.2">${p.titulo}</td><td style="text-align:right"><span class="sticker-precio" style="font-size:2.6mm">${pesos(p.mayorista)}</span></td><td class="m" style="text-align:right;font-size:2.4mm;color:#585d6c;padding-left:2mm">${pesos(p.minorista)}</td></tr>`).join("")}</tbody>
    </table>
    <div style="margin-top:auto;display:grid;grid-template-columns:1fr 26mm;gap:5mm;align-items:end">
      <div style="display:grid;gap:1.3mm;font-size:2.6mm;line-height:1.35">
        <p><b>Precio por mayor</b> en pedidos desde ${pesos(NEGOCIO.minimoMayorista)}; debajo rige el precio suelto. Envío sin cargo desde ${pesos(NEGOCIO.envioSinCargoDesde)}.</p>
        <p><b>Reparto:</b> ${reparto.map((r) => `${r.zona} ${corto(r.dias).toLowerCase()}`).join(" · ")}.</p>
        <p style="color:#585d6c">Precios finales con IVA, vigentes al ${hoy}. La lista completa y actualizada (${PRODUCTOS.length} artículos) está en ${dominio}.</p>
        <p class="m" style="font-size:4.4mm;font-weight:600;margin-top:1mm">${iconoWa} ${wa}</p>
      </div>
      <div style="border:.3mm solid #d9dce4;border-radius:1.2mm">${await qr("ficha")}</div>
    </div>
  </div>`),
], "El dorso lleva precios con fecha: reimprimilo cuando cambie la lista.");

// Tarjeta 90×50 doble faz
pieza("04-tarjeta-90x50-doble-faz", 90, 50, [
  hoja(90, 50, "cobalto", `
  <div class="seguro" style="align-items:center;justify-content:center;gap:2mm;padding-bottom:5mm">
    <div style="font-size:3mm">${marca("#fff", "#17288e").replace("<b>", '<b style="font-size:8.4mm">').replace('class="logo-iso"', 'class="logo-iso" style="width:11mm;height:11mm"')}</div>
  </div>
  <div class="cinta" style="bottom:4.5mm;height:4mm;font-size:1.8mm">${["Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")} · ${["Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")}</div>`),
  hoja(90, 50, "", `
  <div class="seguro" style="flex-direction:row;gap:4mm;align-items:center">
    <div style="flex:1;display:grid;gap:1.4mm">
      <p class="d" style="font-size:5.4mm">${NEGOCIO.contacto || "Atención comercial"}</p>
      <p class="etq" style="font-size:1.9mm;color:#585d6c">${NEGOCIO.nombre} · ${NEGOCIO.bajada}</p>
      <p class="m" style="font-size:3.8mm;font-weight:600;margin-top:1.5mm;white-space:nowrap">${iconoWa} ${wa}</p>
      <p style="font-size:2.7mm"><b>${dominio}</b></p>
      <p style="font-size:2.3mm;color:#585d6c">Reparto propio en ${NEGOCIO.zona}</p>
    </div>
    <div style="width:22mm;flex:none;border:.3mm solid #d9dce4;border-radius:1mm">${await qr("tarjeta")}</div>
  </div>`),
]);

// Carpeta: tapa y contratapa abiertas (contratapa a la izquierda, tapa a la derecha)
pieza("05-carpeta-tapa-contratapa-A4-abierta", 420, 297, [hoja(420, 297, "", `
  <div class="papel" style="position:absolute;left:0;top:0;bottom:0;width:213mm"></div>
  <div class="cobalto" style="position:absolute;right:0;top:0;bottom:0;width:213mm"></div>
  <div style="position:absolute;left:16mm;top:20mm;bottom:20mm;width:180mm;display:flex;flex-direction:column;gap:7mm">
    <div style="font-size:4.4mm;color:#12141a">${marca("#17288e", "#fff").replace("<b>", '<b style="font-size:9mm">').replace('class="logo-iso"', 'class="logo-iso" style="width:13mm;height:13mm"')}</div>
    <h2 class="d" style="font-size:13mm;margin-top:6mm">Reparto propio,<br>dos veces por semana</h2>
    <table style="border-collapse:collapse;font-size:4mm;width:100%">
      ${reparto.map((r) => `<tr class="punteado"><td class="d" style="font-size:6mm;padding:3mm 0;width:72mm">${r.zona}</td><td style="padding:3mm 0">${r.dias}<br><span style="font-size:3.2mm;color:#585d6c">${r.barrios}</span></td></tr>`).join("")}
    </table>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6mm;margin-top:8mm">
      ${[["Armás el pedido", "En la web, con un kit por rubro o pegando tu lista de códigos."], ["Lo confirmamos", "Por WhatsApp: disponibilidad, día de entrega y forma de pago."], ["Te lo llevamos", "Con factura, el día fijo de tu zona. O programado cada mes."]].map(([t, d], i) => `<div style="border-top:.6mm solid #12141a;padding-top:3mm"><p class="m" style="font-size:3mm;color:#17288e;font-weight:600">0${i + 1}</p><p class="d" style="font-size:6mm;margin-top:1.5mm">${t}</p><p style="font-size:3.4mm;color:#585d6c;margin-top:1.5mm;line-height:1.4">${d}</p></div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;gap:9mm;align-items:flex-end">
      <div style="width:42mm;border:.3mm solid #d9dce4;border-radius:1.5mm">${await qr("carpeta")}</div>
      <div style="display:grid;gap:2.4mm">
        <p class="etq" style="font-size:3mm;color:#585d6c">Pedidos, cotizaciones y cuenta mayorista</p>
        <p class="m" style="font-size:9mm;font-weight:600;white-space:nowrap">${iconoWa} ${wa}</p>
        <p style="font-size:5mm"><b>${dominio}</b></p>
        <p style="font-size:3.6mm;color:#585d6c">${NEGOCIO.horario}</p>
      </div>
    </div>
  </div>
  <div style="position:absolute;right:16mm;top:20mm;bottom:20mm;width:180mm;display:flex;flex-direction:column;color:#fff">
    <div style="font-size:4.4mm">${marca("#fff", "#17288e").replace("<b>", '<b style="font-size:11mm">').replace('class="logo-iso"', 'class="logo-iso" style="width:16mm;height:16mm"')}</div>
    <h1 class="d" style="font-size:25mm;margin-top:26mm">Insumos para<br>que tu negocio<br><span class="si">no se quede<br>sin nada.</span></h1>
    <div style="margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:3mm">
      ${RUBROS.map((r) => `<div style="display:flex;gap:2.5mm;align-items:center;border-top:.4mm solid rgba(255,255,255,.35);padding-top:2.5mm"><div style="width:11mm;height:11mm;flex:none;color:#fff">${pic(r.icono)}</div><span class="d" style="font-size:4.6mm">${r.corto}</span></div>`).join("")}
    </div>
  </div>
  <div class="cinta" style="left:200mm;right:-10mm;top:212mm;height:9mm;font-size:3.4mm">${Array.from({ length: 3 }, () => [NEGOCIO.nombre, "Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")).join(" · ")}</div>`)],
  "Abierta: contratapa a la izquierda, tapa a la derecha. El bolsillo y el troquel los adapta la imprenta.");

// Interiores A4
const kitC = totalKit(NEGOCIO.kits.find((k) => k.id === "consorcios").items);
const cabezaA4 = (titulo) => `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:.6mm solid #12141a;padding-bottom:4mm"><div style="font-size:3.3mm;color:#12141a">${marca("#17288e", "#fff").replace("<b>", '<b style="font-size:6.4mm">').replace('class="logo-iso"', 'class="logo-iso" style="width:10mm;height:10mm"')}</div><p class="etq" style="font-size:2.6mm;color:#585d6c;text-align:right">${titulo}</p></div>`;
const pieA4 = async (pieza) => `<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;border-top:.3mm solid #d9dce4;padding-top:4mm;font-size:3mm"><div style="display:grid;gap:1.2mm"><p class="m" style="font-size:5mm;font-weight:600">${iconoWa} ${wa}</p><p><b>${dominio}</b> · ${NEGOCIO.horario}</p></div><div style="width:22mm">${await qr(pieza)}</div></div>`;
const blanco = (ancho) => `<span style="display:inline-block;width:${ancho}mm;border-bottom:.25mm solid #12141a;transform:translateY(-.8mm)"></span>`;
pieza("06-carpeta-interiores-A4", 210, 297, [
  hoja(210, 297, "", `<div class="seguro" style="inset:17mm 20mm;gap:6mm;font-size:3.8mm;line-height:1.55">
    ${cabezaA4("Propuesta para administraciones")}
    <p style="margin-top:4mm">Buenos Aires, ${blanco(45)}</p>
    <p>Sres. ${blanco(95)}<br>Administración de consorcios</p>
    <p>Nos presentamos: somos <b>${NEGOCIO.nombre}</b>, distribuidora de artículos de limpieza, bolsas y descartables con <b>reparto propio en ${NEGOCIO.zona}</b>.</p>
    <p>Les proponemos resolver la reposición de insumos de sus edificios con un pedido base por edificio que llega todos los meses, en portería y con factura por edificio para la liquidación de expensas. El encargado deja de comprar a último momento y caro, y ustedes tienen un solo proveedor, un solo precio y el detalle de cada gasto.</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;margin-block:2mm">
      ${[["Precio por mayor", `Desde ${pesos(NEGOCIO.minimoMayorista)} por pedido, sobre toda la lista.`], ["Día fijo de entrega", "Dos recorridos por semana en cada zona."], ["Factura por edificio", "Con el detalle de cada artículo."]].map(([t, d]) => `<div style="border-top:.5mm solid #12141a;padding-top:2mm"><p class="d" style="font-size:5mm">${t}</p><p style="font-size:3.2mm;color:#585d6c;margin-top:1mm;line-height:1.4">${d}</p></div>`).join("")}
    </div>
    <p>Edificios que administran en nuestras zonas de reparto:</p>
    <div style="display:grid;gap:5.5mm">${Array.from({ length: 5 }, () => `<div class="linea"></div>`).join("")}</div>
    <p style="margin-top:2mm">Adjuntamos nuestras condiciones comerciales y una propuesta de reposición por edificio. Quedamos a disposición para armarla a medida del consumo de cada consorcio.</p>
    <p style="margin-top:6mm">Saludos cordiales,<br><br>${blanco(70)}<br><b>${NEGOCIO.contacto || NEGOCIO.nombre}</b></p>
    ${await pieA4("carpeta")}
  </div>`),
  hoja(210, 297, "", `<div class="seguro" style="inset:17mm 20mm;gap:6mm;font-size:3.7mm;line-height:1.5">
    ${cabezaA4("Condiciones comerciales")}
    <h1 class="d" style="font-size:12mm;margin-top:3mm">Cómo trabajamos</h1>
    ${[
      ["Precios", `Lista publicada y actualizada en ${dominio}. Precios finales con IVA incluido. <b>Precio por mayor</b> en pedidos desde ${pesos(NEGOCIO.minimoMayorista)}; debajo de ese monto rige el precio suelto.`],
      ["Entregas", `Reparto propio con día fijo por zona. Pedidos confirmados hasta las ${NEGOCIO.corte} salen en el próximo recorrido. Envío sin cargo desde ${pesos(NEGOCIO.envioSinCargoDesde)}.`],
      ["Zonas y días", reparto.map((r) => `<b>${r.zona}:</b> ${r.dias.toLowerCase()} (${r.barrios})`).join("<br>")],
      ["Cómo pedir", `Por WhatsApp al ${wa}, en la web armando el pedido, o con el <b>pedido rápido</b> pegando tu lista de códigos. También podemos dejar programada una <b>reposición mensual</b>.`],
      ["Pagos", "Transferencia, efectivo o Mercado Pago al momento de la entrega. Cuenta corriente disponible para clientes con compras frecuentes."],
      ["Facturación", "Emitimos factura C en cada entrega, con el detalle de cada artículo."],
    ].map(([t, d]) => `<div style="display:grid;grid-template-columns:42mm 1fr;gap:6mm;border-top:.3mm solid #d9dce4;padding-top:3.5mm"><p class="d" style="font-size:5.6mm">${t}</p><p>${d}</p></div>`).join("")}
    ${await pieA4("carpeta")}
  </div>`),
  hoja(210, 297, "", `<div class="seguro" style="inset:17mm 20mm;gap:5mm;font-size:3.6mm;line-height:1.45">
    ${cabezaA4(`Propuesta de reposición · precios al ${hoy}`)}
    <h1 class="d" style="font-size:12mm;margin-top:3mm">Kit mensual por edificio</h1>
    <p style="color:#585d6c">Punto de partida calculado para un edificio de consumo medio. Lo ajustamos a cada consorcio según su tamaño y uso.</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr class="etq" style="font-size:2.4mm;color:#585d6c;text-align:left;border-bottom:.5mm solid #12141a"><th style="padding:2mm 0;width:9mm"></th><th style="width:14mm">Cant.</th><th>Artículo</th><th style="text-align:right">Por mayor c/u</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>${kitC.lista.map(([c, n]) => { const p = porCodigo.get(c); return `<tr class="punteado"><td style="padding:1.6mm 0"><div class="tono-${p.rubroId}" style="width:7mm;height:7mm;border-radius:.8mm;padding:1mm;color:#17288e">${pic(p.icono)}</div></td><td class="m" style="font-weight:600">${n}</td><td>${p.titulo} <span class="m" style="font-size:2.6mm;color:#585d6c">${p.codigo}</span></td><td class="m" style="text-align:right">${pesos(p.mayorista)}</td><td class="m" style="text-align:right">${pesos(p.mayorista * n)}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td colspan="4" style="padding-top:3mm;text-align:right;font-weight:700">Total por edificio, por mes</td><td class="m" style="padding-top:3mm;text-align:right"><span class="sticker-precio" style="font-size:4mm">${pesos(kitC.total)}</span></td></tr></tfoot>
    </table>
    <p class="d" style="font-size:6mm;margin-top:4mm">Edificios incluidos</p>
    <table style="width:100%;border-collapse:collapse;font-size:3.2mm">
      <thead><tr class="etq" style="font-size:2.3mm;color:#585d6c;text-align:left;border-bottom:.5mm solid #12141a"><th style="padding:2mm 0">Dirección</th><th>Encargado / teléfono</th><th style="width:30mm">Día de entrega</th></tr></thead>
      <tbody>${Array.from({ length: 6 }, () => `<tr style="border-bottom:.25mm solid #b9bdc8"><td style="height:9mm"></td><td></td><td></td></tr>`).join("")}</tbody>
    </table>
    <p style="font-size:3mm;color:#585d6c">Precios finales con IVA, vigentes al ${hoy}. Se confirman al aceptar cada pedido.</p>
    ${await pieA4("carpeta")}
  </div>`),
], "Interiores de la carpeta: carta, condiciones y propuesta. La propuesta lleva precios con fecha.");

// Ploteo lateral de la camioneta (referencia a escala 1:10, proporción 3:1)
pieza("07-ploteo-camioneta-lateral-referencia", 300, 100, [hoja(300, 100, "", `
  <div style="position:absolute;inset:0;background:#fff"></div>
  <div class="cobalto" style="position:absolute;left:0;right:0;bottom:0;height:46mm"></div>
  <div style="position:absolute;left:14mm;top:12mm;font-size:3.4mm;color:#12141a">${marca("#17288e", "#fff").replace("<b>", '<b style="font-size:12mm">').replace('class="logo-iso"', 'class="logo-iso" style="width:17mm;height:17mm"')}</div>
  <p class="d" style="position:absolute;left:14mm;top:36mm;font-size:6mm;color:#17288e">Limpieza · Bolsas · Descartables · Embalaje</p>
  <div style="position:absolute;right:16mm;top:9mm;display:flex;gap:3mm;color:#17288e">${["bolsa", "bidon", "rollo", "vaso", "escoba", "caja"].map((n) => `<div style="width:11mm;height:11mm">${pic(n)}</div>`).join("")}</div>
  <div style="position:absolute;left:14mm;bottom:9mm;color:#fff;display:grid;gap:1.6mm">
    <p class="etq" style="font-size:2.6mm;opacity:.8">Pedidos por WhatsApp</p>
    <p class="m si" style="font-size:12mm;font-weight:600;white-space:nowrap">${iconoWa} ${wa}</p>
  </div>
  <div style="position:absolute;right:16mm;bottom:8mm;display:flex;gap:4mm;align-items:flex-end;color:#fff">
    <div style="text-align:right;display:grid;gap:1mm"><p class="d" style="font-size:7mm">${dominio}</p><p style="font-size:3mm;opacity:.85">Reparto propio en ${NEGOCIO.zona}</p></div>
    <div style="width:28mm">${await qr("camioneta")}</div>
  </div>
  <div class="cinta" style="top:49mm;height:6mm;font-size:2.4mm;left:-10mm;right:-10mm">${Array.from({ length: 4 }, () => [NEGOCIO.nombre, "Reparto propio", "Precio por mayor", NEGOCIO.zona].join(" · ")).join(" · ")}</div>`)],
  "Referencia a escala 1:10 y proporción 3:1. El ploteador la adapta a las medidas reales de la camioneta (ruedas, puertas y manijas).");

// ---------- Render ----------
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 2 });
const resumen = [];
for (const p of PIEZAS) {
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><style>${CSS} @page { size: ${p.ancho + 6}mm ${p.alto + 6}mm; margin: 0; }</style></head><body>${p.paginas.join("")}</body></html>`;
  const archivoHtml = join(TMP, `${p.archivo}.html`);
  writeFileSync(archivoHtml, html);
  await pagina.goto(pathToFileURL(archivoHtml).href);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.pdf({ path: join(SALIDA, `${p.archivo}.pdf`), width: `${p.ancho + 6}mm`, height: `${p.alto + 6}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  const hojas = pagina.locator("section.hoja");
  const n = await hojas.count();
  for (let i = 0; i < n; i++) await hojas.nth(i).screenshot({ path: join(PREVIAS, `${p.archivo}${n > 1 ? `-${i + 1}` : ""}.png`) });
  resumen.push(`${p.archivo}.pdf · ${p.ancho}×${p.alto} mm + 3 mm de sangrado · ${n} ${n > 1 ? "caras" : "cara"}${p.nota ? ` · ${p.nota}` : ""}`);
}
await navegador.close();
writeFileSync(join(TMP, "qrs.json"), JSON.stringify(qrs, null, 1));
console.log(resumen.join("\n"));
console.log("QR:", qrs);
