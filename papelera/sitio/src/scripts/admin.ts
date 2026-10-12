// Panel administrativo de Doble Hoja. Edita negocio.json y productos.json y los guarda en GitHub.
type Producto = { codigo: string; nombre: string; rubro: string; mayorista: number; minorista: number };
type Negocio = Record<string, any>;
type Archivo = "negocio" | "productos";

const RUBROS = [
  "QUÍMICOS Y LIMPIEZA",
  "ARTÍCULOS DE LIMPIEZA",
  "BOLSAS",
  "PAPEL HIGIÉNICO, TOALLAS Y SERVILLETAS",
  "DESCARTABLES GASTRONÓMICOS",
  "EMBALAJE, PAPELES Y LIBRERÍA",
];
const DESTINOS: [string, string][] = [
  ["", "Inicio"], ["lista", "Lista de precios"], ["gastronomia", "Gastronomía"], ["consorcios", "Consorcios"],
  ["oficinas", "Oficinas"], ["pedido-rapido", "Pedido rápido"], ["cuenta-mayorista", "Cuenta mayorista"],
];
const ICONOS_KIT = ["verdura", "toldo", "carne", "pan", "pizza", "olla", "taza", "helado", "edificio", "maletin", "pesa", "caja", "bolsa", "bidon", "vaso", "servilleta", "bandeja", "escoba"];
const FIJOS = ["gastronomia", "consorcios", "oficinas"]; // tienen página de rubro propia
const destinos = (): [string, string][] => [...DESTINOS, ...est.negocio.kits.map((k: any): [string, string] => [`kit/${k.id}`, `Kit: ${k.rubro}`])];
const PREDETERMINADO = {
  repo: "luchocordoba3/super-chino",
  rama: "main",
  rutas: { negocio: "papelera/sitio/src/datos/negocio.json", productos: "papelera/sitio/src/datos/productos.json" } as Record<Archivo, string>,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const plata = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const $$ = (n: number) => plata.format(n);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x));
// Mismo formato que escriben generar-catalogo.py y el repo, para que los cambios en GitHub sean limpios.
const texto = (a: Archivo, datos: unknown) => JSON.stringify(datos, null, a === "productos" ? 1 : 2) + "\n";

// ---------- Estado ----------
const inicial = JSON.parse($("datos-admin").textContent || "{}");
const est = {
  negocio: clonar(inicial.negocio) as Negocio,
  productos: clonar(inicial.productos) as Producto[],
  original: { negocio: texto("negocio", inicial.negocio), productos: texto("productos", inicial.productos) } as Record<Archivo, string>,
  sha: { negocio: "", productos: "" } as Record<Archivo, string>,
  token: "",
  repo: PREDETERMINADO.repo,
  rama: PREDETERMINADO.rama,
  prueba: true,
  tab: "precios",
};
let originalPorCodigo = new Map((inicial.productos as Producto[]).map((p) => [p.codigo, p]));

const leer = (clave: string) => { try { return localStorage.getItem(clave) ?? sessionStorage.getItem(clave); } catch { return null; } };
function guardarLocal(clave: string, valor: string, recordar: boolean) {
  try {
    (recordar ? localStorage : sessionStorage).setItem(clave, valor);
    (recordar ? sessionStorage : localStorage).removeItem(clave);
  } catch { /* sin almacenamiento */ }
}

let temporizador: ReturnType<typeof setTimeout>;
function avisar(msg: string) {
  $("aviso-texto").textContent = msg;
  $("aviso").classList.add("visible");
  clearTimeout(temporizador);
  temporizador = setTimeout(() => $("aviso").classList.remove("visible"), 3200);
}

function mostrar(titulo: string, contenido: string) {
  $("dialogo-titulo").textContent = titulo;
  $("dialogo-texto").textContent = contenido;
  $<HTMLDialogElement>("dialogo").showModal();
}

// ---------- GitHub ----------
const b64 = {
  codificar: (s: string) => { const b = new TextEncoder().encode(s); let bin = ""; b.forEach((x) => (bin += String.fromCharCode(x))); return btoa(bin); },
  decodificar: (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0))),
};

async function github(ruta: string, opciones: RequestInit = {}) {
  const r = await fetch(`https://api.github.com/repos/${est.repo}/contents/${ruta}`, {
    ...opciones,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${est.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opciones.headers || {}) },
  });
  if (!r.ok) {
    const motivo: Record<number, string> = {
      401: "El token no es válido o venció.",
      403: "El token no tiene permiso de escritura en ese repositorio.",
      404: "No encuentro el archivo: revisá el repositorio, la rama y que el token tenga acceso a ese repositorio.",
      409: "Alguien guardó cambios antes que vos. Volvé a conectar para traer la última versión.",
      422: "GitHub rechazó el cambio. Volvé a conectar e intentá de nuevo.",
    };
    throw new Error(motivo[r.status] || `GitHub respondió ${r.status}.`);
  }
  return r.json();
}

async function traer(a: Archivo) {
  const d = await github(`${PREDETERMINADO.rutas[a]}?ref=${encodeURIComponent(est.rama)}`);
  est.sha[a] = d.sha;
  const txt = b64.decodificar(d.content);
  est.original[a] = txt;
  return JSON.parse(txt);
}

async function conectar(e: Event) {
  e.preventDefault();
  const error = $("c-error");
  error.hidden = true;
  est.token = $<HTMLInputElement>("c-token").value.trim();
  est.repo = $<HTMLInputElement>("c-repo").value.trim() || PREDETERMINADO.repo;
  est.rama = $<HTMLInputElement>("c-rama").value.trim() || PREDETERMINADO.rama;
  if (!est.token) { error.textContent = "Pegá el token para conectar, o usá el modo prueba."; error.hidden = false; return; }
  try {
    const [n, p] = await Promise.all([traer("negocio"), traer("productos")]);
    est.negocio = n;
    est.productos = p;
    originalPorCodigo = new Map((p as Producto[]).map((x) => [x.codigo, clonar(x)]));
    est.prueba = false;
    const recordar = $<HTMLInputElement>("c-recordar").checked;
    guardarLocal("dh-admin-token", est.token, recordar);
    guardarLocal("dh-admin-repo", JSON.stringify({ repo: est.repo, rama: est.rama }), true);
    abrirPanel(`Conectado a ${est.repo} · rama ${est.rama}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  }
}

function abrirPanel(estado: string) {
  $("estado-conexion").textContent = estado;
  $("conexion").hidden = true;
  $("panel").hidden = false;
  $("pie").hidden = false;
  $("guardar").textContent = est.prueba ? "Modo prueba: ver resultado" : "Guardar y publicar";
  pintar();
}

function pendientes(): Archivo[] {
  return (["negocio", "productos"] as Archivo[]).filter((a) => texto(a, est[a]) !== est.original[a]);
}

async function guardar() {
  const cambios = pendientes();
  if (!cambios.length) { avisar("No hay cambios para guardar."); return; }
  if (est.prueba) { verResultado(); return; }
  const b = $<HTMLButtonElement>("guardar");
  b.disabled = true;
  b.textContent = "Guardando…";
  try {
    for (const a of cambios) {
      const contenido = texto(a, est[a]);
      const r = await github(PREDETERMINADO.rutas[a], {
        method: "PUT",
        body: JSON.stringify({
          message: a === "productos" ? `Panel: actualiza precios (${resumenPrecios().total} cambios)` : "Panel: actualiza datos del negocio",
          content: b64.codificar(contenido),
          sha: est.sha[a],
          branch: est.rama,
        }),
      });
      est.sha[a] = r.content.sha;
      est.original[a] = contenido;
    }
    originalPorCodigo = new Map(est.productos.map((p) => [p.codigo, clonar(p)]));
    avisar("Guardado. La web se actualiza sola en uno o dos minutos.");
  } catch (err) {
    mostrar("No se pudo guardar", (err as Error).message);
  } finally {
    b.disabled = false;
    b.textContent = "Guardar y publicar";
    pintar();
  }
}

function verResultado() {
  const cambios = pendientes();
  if (!cambios.length) { mostrar("Sin cambios", "Todavía no cambiaste nada."); return; }
  const r = resumenPrecios();
  const partes = cambios.map((a) => {
    if (a === "productos") return `productos.json · ${r.cambiados} con precio nuevo, ${r.altas} altas, ${r.bajas} bajas`;
    return `negocio.json\n\n${texto("negocio", est.negocio)}`;
  });
  mostrar(est.prueba ? "Resultado (modo prueba: no se guarda)" : "Cambios por guardar", partes.join("\n\n—\n\n"));
}

function descartar() {
  const b = $("descartar");
  if (b.dataset.confirmar !== "1") {
    b.dataset.confirmar = "1";
    b.textContent = "Tocá de nuevo para descartar";
    setTimeout(() => { b.dataset.confirmar = ""; b.textContent = "Descartar"; }, 3000);
    return;
  }
  b.dataset.confirmar = "";
  b.textContent = "Descartar";
  est.negocio = JSON.parse(est.original.negocio);
  est.productos = JSON.parse(est.original.productos);
  pintar();
}

// ---------- Resumen de cambios ----------
function resumenPrecios() {
  const actuales = new Set(est.productos.map((p) => p.codigo));
  let cambiados = 0, altas = 0;
  for (const p of est.productos) {
    const o = originalPorCodigo.get(p.codigo);
    if (!o) altas++;
    else if (o.mayorista !== p.mayorista || o.minorista !== p.minorista || o.nombre !== p.nombre) cambiados++;
  }
  const bajas = [...originalPorCodigo.keys()].filter((c) => !actuales.has(c)).length;
  return { cambiados, altas, bajas, total: cambiados + altas + bajas };
}

function pintarPie() {
  const cambios = pendientes();
  const r = resumenPrecios();
  const partes: string[] = [];
  if (cambios.includes("productos")) partes.push(`precios: ${r.cambiados} cambiados${r.altas ? `, ${r.altas} altas` : ""}${r.bajas ? `, ${r.bajas} bajas` : ""}`);
  if (cambios.includes("negocio")) partes.push("datos del negocio");
  $("resumen-cambios").textContent = partes.length ? `Sin guardar: ${partes.join(" · ")}` : est.prueba ? "Modo prueba: los cambios no se guardan" : "Todo guardado";
}

// ---------- Pestañas ----------
const vista = { busca: "", rubro: "", soloCambios: false, masivo: { rubro: "", pct: 10, aplica: "ambos", redondeo: 10 }, pdf: null as null | { productos: Producto[]; sinLeer: string[] } };

function pintar() {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === est.tab)));
  const c = $("contenido-tab");
  c.innerHTML = ({ precios: tabPrecios, pdf: tabPdf, negocio: tabNegocio, kits: tabKits, qr: tabQr, avanzado: tabAvanzado } as Record<string, () => string>)[est.tab]();
  pintarPie();
}

const opcionesRubro = (sel: string, todos = "Todos los rubros") => `<option value="">${todos}</option>${RUBROS.map((r) => `<option value="${esc(r)}"${r === sel ? " selected" : ""}>${esc(r)}</option>`).join("")}`;
const redondear = (n: number, paso: number) => Math.max(paso, Math.round(n / paso) * paso);

function afectados() {
  return est.productos.filter((p) => !vista.masivo.rubro || p.rubro === vista.masivo.rubro);
}
function aplicarMasivo(p: Producto) {
  const f = 1 + vista.masivo.pct / 100;
  const r = vista.masivo.redondeo;
  return {
    mayorista: vista.masivo.aplica !== "suelto" ? redondear(p.mayorista * f, r) : p.mayorista,
    minorista: vista.masivo.aplica !== "mayor" ? redondear(p.minorista * f, r) : p.minorista,
  };
}

function tabPrecios() {
  const q = norm(vista.busca).split(/\s+/).filter(Boolean);
  const filas = est.productos.filter((p) => {
    const o = originalPorCodigo.get(p.codigo);
    const cambiado = !o || o.mayorista !== p.mayorista || o.minorista !== p.minorista;
    return (!vista.rubro || p.rubro === vista.rubro) && q.every((t) => norm(`${p.codigo} ${p.nombre}`).includes(t)) && (!vista.soloCambios || cambiado);
  });
  const ej = afectados()[0];
  const m = vista.masivo;
  return `
  <h2>Suba o baja masiva</h2>
  <div class="admin-masivo">
    <label>Rubro<select data-masivo="rubro">${opcionesRubro(m.rubro, "Toda la lista")}</select></label>
    <label>Porcentaje<input type="number" step="0.5" data-masivo="pct" value="${m.pct}" style="width:6rem"></label>
    <label>Aplicar a<select data-masivo="aplica">
      <option value="ambos"${m.aplica === "ambos" ? " selected" : ""}>Por mayor y suelto</option>
      <option value="mayor"${m.aplica === "mayor" ? " selected" : ""}>Solo por mayor</option>
      <option value="suelto"${m.aplica === "suelto" ? " selected" : ""}>Solo suelto</option></select></label>
    <label>Redondeo<select data-masivo="redondeo">${[1, 10, 50, 100].map((r) => `<option value="${r}"${r === m.redondeo ? " selected" : ""}>A $${r}</option>`).join("")}</select></label>
    <button class="btn btn--tinta" type="button" data-accion="masivo">Aplicar a ${afectados().length} artículos</button>
    <p>${ej ? `Ejemplo: ${esc(ej.nombre)} pasa de ${$$(ej.mayorista)} / ${$$(ej.minorista)} a <b>${$$(aplicarMasivo(ej).mayorista)} / ${$$(aplicarMasivo(ej).minorista)}</b>. Usá un número negativo para bajar.` : "No hay artículos en ese rubro."}</p>
  </div>
  <h2>Lista de precios</h2>
  <div class="admin-barra">
    <label>Buscar<input type="search" data-vista="busca" value="${esc(vista.busca)}" placeholder="Código o nombre" style="width:16rem"></label>
    <label>Rubro<select data-vista="rubro">${opcionesRubro(vista.rubro)}</select></label>
    <label class="casilla" style="align-self:center;margin-top:1.2rem"><input type="checkbox" data-vista="soloCambios"${vista.soloCambios ? " checked" : ""}> <span>Solo modificados</span></label>
    <span class="admin-nota" style="margin-left:auto">${filas.length} de ${est.productos.length} artículos</span>
  </div>
  <div class="admin-tabla-env"><table class="admin-tabla">
    <thead><tr><th>Código</th><th>Artículo</th><th>Rubro</th><th>Por mayor</th><th>Suelto</th><th></th></tr></thead>
    <tbody>${filas.map((p) => {
      const o = originalPorCodigo.get(p.codigo);
      const clase = !o ? "nuevo" : o.mayorista !== p.mayorista || o.minorista !== p.minorista ? "cambiado" : "";
      return `<tr class="${clase}" data-codigo="${esc(p.codigo)}">
        <td class="cod">${esc(p.codigo)}</td>
        <td><input data-campo="nombre" value="${esc(p.nombre)}" style="width:100%;min-width:16rem"></td>
        <td class="admin-nota">${esc(p.rubro.split(",")[0].toLowerCase())}</td>
        <td><input type="number" min="0" step="10" data-campo="mayorista" value="${p.mayorista}"></td>
        <td><input type="number" min="0" step="10" data-campo="minorista" value="${p.minorista}"></td>
        <td><button class="quitar" type="button" data-accion="borrar" aria-label="Borrar ${esc(p.codigo)}" title="Borrar">×</button></td></tr>`;
    }).join("")}</tbody>
  </table></div>
  <h2>Agregar artículo</h2>
  <div class="admin-barra">
    <label>Código<input id="n-codigo" placeholder="LB9999" style="width:7rem;text-transform:uppercase"></label>
    <label>Nombre<input id="n-nombre" style="width:18rem"></label>
    <label>Rubro<select id="n-rubro">${RUBROS.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
    <label>Por mayor<input id="n-mayor" type="number" min="0" style="width:7rem"></label>
    <label>Suelto<input id="n-suelto" type="number" min="0" style="width:7rem"></label>
    <button class="btn btn--linea" type="button" data-accion="agregar">Agregar</button>
  </div>`;
}

function tabPdf() {
  const r = vista.pdf;
  let detalle = "";
  if (r) {
    const actual = new Map(est.productos.map((p) => [p.codigo, p]));
    const nuevos = new Map(r.productos.map((p) => [p.codigo, p]));
    const altas = r.productos.filter((p) => !actual.has(p.codigo));
    const bajas = est.productos.filter((p) => !nuevos.has(p.codigo));
    const cambios = r.productos.filter((p) => { const a = actual.get(p.codigo); return a && (a.mayorista !== p.mayorista || a.minorista !== p.minorista); });
    detalle = `
    <div class="admin-cambios" style="margin-top:1rem">
      <p><b>${r.productos.length} artículos leídos</b> en ${new Set(r.productos.map((p) => p.rubro)).size} rubros.</p>
      <p>${cambios.length} con precio distinto · <span class="mas">${altas.length} altas</span> · <span class="menos">${bajas.length} bajas</span></p>
      ${r.sinLeer.length ? `<p class="menos">Renglones que no se pudieron leer (${r.sinLeer.length}): ${r.sinLeer.slice(0, 5).map(esc).join(" · ")}</p>` : ""}
    </div>
    ${cambios.length ? `<div class="admin-tabla-env"><table class="admin-tabla" style="margin-top:1rem"><thead><tr><th>Código</th><th>Artículo</th><th>Por mayor</th><th>Suelto</th></tr></thead><tbody>
      ${cambios.slice(0, 40).map((p) => { const a = actual.get(p.codigo)!; return `<tr><td class="cod">${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td class="m">${$$(a.mayorista)} → <b>${$$(p.mayorista)}</b></td><td class="m">${$$(a.minorista)} → <b>${$$(p.minorista)}</b></td></tr>`; }).join("")}
    </tbody></table></div>${cambios.length > 40 ? `<p class="admin-nota">Y ${cambios.length - 40} más.</p>` : ""}` : ""}
    ${altas.length ? `<p style="margin-top:1rem"><b>Altas:</b> ${altas.map((p) => esc(`${p.codigo} ${p.nombre}`)).join(" · ")}</p>` : ""}
    ${bajas.length ? `<p style="margin-top:.5rem"><b>Bajas:</b> ${bajas.map((p) => esc(`${p.codigo} ${p.nombre}`)).join(" · ")}</p>` : ""}
    <button class="btn btn--tinta" type="button" data-accion="usar-pdf" style="margin-top:1.2rem"${r.productos.length ? "" : " disabled"}>Reemplazar la lista por esta</button>`;
  }
  return `
  <h2>Cargar una lista nueva</h2>
  <p class="bajada" style="font-size:.95rem">Subí el PDF de tu lista de precios (el mismo formato de siempre). Se lee acá mismo, sin subirlo a ningún lado, y te muestra qué cambia antes de reemplazar nada.</p>
  <div class="admin-barra" style="margin-top:1rem"><label>PDF de la lista<input type="file" id="pdf" accept="application/pdf"></label></div>
  <p class="admin-nota" id="pdf-estado"></p>
  ${detalle}`;
}

const campo = (ruta: string, etiqueta: string, ayuda = "", tipo = "text") => {
  const valor = ruta.split(".").reduce((o: any, k) => o?.[k], est.negocio);
  return `<label>${etiqueta}${ayuda ? ` <small>${ayuda}</small>` : ""}<input type="${tipo}" data-negocio="${ruta}" value="${esc(valor)}"></label>`;
};

function tabNegocio() {
  return `
  <h2>Datos del negocio</h2>
  <div class="admin-grilla">
    ${campo("nombre", "Nombre")}
    ${campo("bajada", "Bajada")}
    ${campo("whatsapp", "WhatsApp para los links", "con 549, sin espacios")}
    ${campo("whatsappVisible", "WhatsApp como se muestra", "ej: 11 7062-3847")}
    ${campo("instagram", "Instagram", "usuario sin @")}
    ${campo("email", "Email")}
    ${campo("contacto", "Nombre en la tarjeta")}
    ${campo("horario", "Horario de atención")}
    ${campo("corte", "Hora de corte de pedidos")}
    ${campo("zona", "Zona de reparto (texto)")}
    ${campo("minimoMayorista", "Mínimo para precio por mayor ($)", "", "number")}
    ${campo("envioSinCargoDesde", "Envío sin cargo desde ($)", "", "number")}
    ${campo("analytics", "Token de Cloudflare Web Analytics", "opcional")}
  </div>
  <h2>Reparto</h2>
  <div class="admin-tabla-env"><table class="admin-tabla"><thead><tr><th>Zona</th><th>Días</th><th>Barrios</th></tr></thead><tbody>
    ${est.negocio.reparto.map((r: any, i: number) => `<tr>
      <td><input data-negocio="reparto.${i}.zona" value="${esc(r.zona)}"></td>
      <td><input data-negocio="reparto.${i}.dias" value="${esc(r.dias)}"></td>
      <td><input data-negocio="reparto.${i}.barrios" value="${esc(r.barrios)}" style="width:100%;min-width:22rem"></td></tr>`).join("")}
  </tbody></table></div>
  <p class="admin-nota" style="margin-top:.6rem">Los textos de las páginas por rubro y las preguntas frecuentes se editan en la pestaña Avanzado.</p>`;
}

function tabKits() {
  const porCod = new Map(est.productos.map((p) => [p.codigo, p]));
  const desconocidos = (est.negocio.destacados as string[]).filter((c) => !porCod.has(c));
  return `
  <h2>Kits por negocio</h2>
  <p class="admin-nota">Cada kit tiene su página en /kit/… y aparece en el asistente del inicio. Conviene que pase el mínimo por mayor.</p>
  ${est.negocio.kits.map((k: any, i: number) => {
    const total = k.items.reduce((s: number, [c, n]: [string, number]) => s + (porCod.get(c)?.mayorista ?? 0) * n, 0);
    return `<div class="admin-kit">
      <div class="admin-grilla">
        <label>Negocio<input data-negocio="kits.${i}.rubro" value="${esc(k.rubro)}"></label>
        <label>Para quién<input data-negocio="kits.${i}.para" value="${esc(k.para)}"></label>
        <label>Dirección <small>/kit/…</small><input data-kit-id="${i}" value="${esc(k.id)}"${FIJOS.includes(k.id) ? " disabled" : ""}></label>
        <label>Ícono<select data-negocio="kits.${i}.icono">${ICONOS_KIT.map((n) => `<option${n === k.icono ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      <table class="admin-tabla"><thead><tr><th>Código</th><th>Artículo</th><th>Cantidad</th><th></th></tr></thead><tbody>
        ${k.items.map(([c, n]: [string, number], j: number) => `<tr>
          <td><input data-kit="${i}.${j}.0" value="${esc(c)}" style="width:7rem;text-transform:uppercase"></td>
          <td>${porCod.has(c) ? esc(porCod.get(c)!.nombre) : '<span class="menos">Código inexistente</span>'}</td>
          <td><input type="number" min="1" data-kit="${i}.${j}.1" value="${n}" style="width:5rem"></td>
          <td><button class="quitar" type="button" data-accion="kit-quitar" data-i="${i}" data-j="${j}" aria-label="Quitar">×</button></td></tr>`).join("")}
      </tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
        <span><button class="btn-texto" type="button" data-accion="kit-agregar" data-i="${i}">+ Agregar artículo</button>${FIJOS.includes(k.id) ? "" : ` <button class="btn-texto menos" type="button" data-accion="kit-borrar" data-i="${i}">Borrar kit</button>`}</span>
        <span>Total por mayor: <b class="m">${$$(total)}</b> ${total < est.negocio.minimoMayorista ? '<span class="menos">(no llega al mínimo por mayor)</span>' : ""}</span>
      </div>
      <label class="admin-nota">Sugeridos al armarlo a medida (códigos separados por espacio)<input data-kit-extras="${i}" value="${esc((k.extras || []).join(" "))}" style="width:100%;font-family:var(--f-dato);text-transform:uppercase"></label>
    </div>`;
  }).join("")}
  <button class="btn btn--linea" type="button" data-accion="kit-nuevo">+ Nuevo kit</button>
  <h2>Destacados de la ficha impresa</h2>
  <p class="admin-nota">Un código por renglón. Son los 20 que salen en el dorso de la ficha A5.</p>
  <textarea data-destacados rows="10" style="width:100%;max-width:22rem;font-family:var(--f-dato);text-transform:uppercase">${esc((est.negocio.destacados as string[]).join("\n"))}</textarea>
  ${desconocidos.length ? `<p class="menos">No existen: ${desconocidos.map(esc).join(", ")}</p>` : ""}`;
}

function tabQr() {
  const sitio = String(est.negocio.sitio || "").replace(/\/$/, "");
  return `
  <h2>Destino de cada QR</h2>
  <p class="admin-nota">Cambiá a dónde lleva cada QR impreso sin reimprimir. El código y la dirección corta no cambian.</p>
  <div class="admin-tabla-env"><table class="admin-tabla" style="margin-top:.8rem"><thead><tr><th>Pieza</th><th>Dirección del QR</th><th>Lleva a</th></tr></thead><tbody>
    ${est.negocio.qr.map((q: any, i: number) => `<tr>
      <td><input data-negocio="qr.${i}.nombre" value="${esc(q.nombre)}"></td>
      <td class="cod">${esc(sitio)}/q/${esc(q.id)}</td>
      <td><select data-negocio="qr.${i}.destino">${destinos().map(([v, t]) => `<option value="${v}"${v === q.destino ? " selected" : ""}>${t}</option>`).join("")}</select></td></tr>`).join("")}
  </tbody></table></div>`;
}

function tabAvanzado() {
  return `
  <h2>Editar negocio.json</h2>
  <p class="admin-nota">Para los textos de las páginas por rubro (segmentos), las preguntas frecuentes y todo lo demás. Si el JSON tiene un error, no se aplica.</p>
  <textarea id="json-avanzado" rows="24" style="width:100%;font:.8rem/1.5 var(--f-dato);margin-top:.8rem">${esc(texto("negocio", est.negocio))}</textarea>
  <p class="formulario__error" id="json-error" hidden></p>
  <button class="btn btn--tinta" type="button" data-accion="json" style="margin-top:.6rem">Aplicar</button>`;
}

// ---------- Lectura del PDF (mismas reglas que generar-catalogo.py) ----------
const FILA = /^\s*([A-Z]{2}\d{4})\s+(.+?)\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)\s*$/;
const CODIGO = /^\s*[A-Z]{2}\d{4}\s/;

export function leerLineas(lineas: string[]) {
  let rubro = "";
  const productos: Producto[] = [];
  const vistos = new Set<string>();
  const sinLeer: string[] = [];
  for (const linea of lineas) {
    const t = linea.trim().replace(/\s+/g, " ");
    if (RUBROS.includes(t)) { rubro = t; continue; }
    const m = linea.match(FILA);
    if (m && rubro) {
      const [, codigo, nombre, may, min] = m;
      if (vistos.has(codigo)) continue;
      vistos.add(codigo);
      productos.push({ codigo, nombre: nombre.replace(/\s+/g, " ").trim().replace(new RegExp(`^${codigo}-`), ""), rubro, mayorista: Number(may.replace(/\./g, "")), minorista: Number(min.replace(/\./g, "")) });
    } else if (CODIGO.test(linea)) sinLeer.push(t);
  }
  return { productos, sinLeer };
}

async function leerPdf(archivo: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
  const lineas: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const contenido = await pag.getTextContent();
    // Agrupa los textos en renglones: los que están a menos de 3 puntos de altura van juntos.
    const items = (contenido.items as any[])
      .filter((it) => "str" in it && it.str.trim())
      .map((it) => ({ x: it.transform[4] as number, y: it.transform[5] as number, s: it.str as string }))
      .sort((a, b) => b.y - a.y);
    const renglones: { y: number; items: typeof items }[] = [];
    for (const it of items) {
      const r = renglones[renglones.length - 1];
      if (r && Math.abs(r.y - it.y) <= 3) r.items.push(it);
      else renglones.push({ y: it.y, items: [it] });
    }
    for (const r of renglones) lineas.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join("  "));
  }
  return leerLineas(lineas);
}

// ---------- Eventos ----------
function fijarRuta(obj: any, ruta: string, valor: unknown) {
  const ks = ruta.split(".");
  const ult = ks.pop()!;
  const destino = ks.reduce((o, k) => o[k], obj);
  destino[ult] = valor;
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const tab = t.closest<HTMLElement>("[data-tab]");
  if (tab) { est.tab = tab.dataset.tab!; pintar(); return; }
  const accion = t.closest<HTMLElement>("[data-accion]")?.dataset.accion;
  if (!accion) return;
  if (accion === "masivo") {
    const lista = afectados();
    lista.forEach((p) => Object.assign(p, aplicarMasivo(p)));
    avisar(`${lista.length} artículos actualizados. Revisalos y guardá.`);
    vista.soloCambios = true;
    pintar();
  } else if (accion === "borrar") {
    const b = t.closest<HTMLElement>("[data-accion]")!;
    if (b.dataset.confirmar !== "1") { b.dataset.confirmar = "1"; b.textContent = "¿Borrar?"; return; }
    const cod = t.closest<HTMLElement>("[data-codigo]")!.dataset.codigo;
    est.productos = est.productos.filter((p) => p.codigo !== cod);
    pintar();
  } else if (accion === "agregar") {
    const codigo = $<HTMLInputElement>("n-codigo").value.trim().toUpperCase();
    const nombre = $<HTMLInputElement>("n-nombre").value.trim().toUpperCase();
    const mayorista = Number($<HTMLInputElement>("n-mayor").value);
    const minorista = Number($<HTMLInputElement>("n-suelto").value);
    if (!/^[A-Z]{2}\d{4}$/.test(codigo)) { avisar("El código tiene que ser 2 letras y 4 números, ej: LB0003."); return; }
    if (est.productos.some((p) => p.codigo === codigo)) { avisar("Ese código ya existe."); return; }
    if (!nombre || !(mayorista > 0) || !(minorista > 0)) { avisar("Completá nombre y los dos precios."); return; }
    est.productos.push({ codigo, nombre, rubro: $<HTMLSelectElement>("n-rubro").value, mayorista, minorista });
    vista.busca = codigo;
    pintar();
  } else if (accion === "usar-pdf" && vista.pdf) {
    est.productos = vista.pdf.productos;
    vista.pdf = null;
    est.tab = "precios";
    vista.soloCambios = true;
    avisar("Lista reemplazada. Revisá los cambios y guardá.");
    pintar();
  } else if (accion === "kit-quitar") {
    est.negocio.kits[Number(t.closest<HTMLElement>("[data-i]")!.dataset.i)].items.splice(Number(t.closest<HTMLElement>("[data-j]")!.dataset.j), 1);
    pintar();
  } else if (accion === "kit-nuevo") {
    const ids = new Set(est.negocio.kits.map((k: any) => k.id));
    let n = 1; while (ids.has(`nuevo-${n}`)) n++;
    est.negocio.kits.push({ id: `nuevo-${n}`, rubro: "Nuevo kit", para: "", icono: "caja", items: [], extras: [] });
    pintar();
  } else if (accion === "kit-borrar") {
    const i = Number(t.closest<HTMLElement>("[data-i]")!.dataset.i);
    if (confirm(`¿Borrar el kit "${est.negocio.kits[i].rubro}"? Si algún QR apunta a su página, cambialo.`)) { est.negocio.kits.splice(i, 1); pintar(); }
  } else if (accion === "kit-agregar") {
    est.negocio.kits[Number(t.closest<HTMLElement>("[data-i]")!.dataset.i)].items.push(["", 1]);
    pintar();
  } else if (accion === "json") {
    try {
      est.negocio = JSON.parse($<HTMLTextAreaElement>("json-avanzado").value);
      avisar("JSON aplicado.");
      pintar();
    } catch (err) {
      const el = $("json-error");
      el.textContent = `El JSON tiene un error: ${(err as Error).message}`;
      el.hidden = false;
    }
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "pdf" && t.files?.[0]) {
    $("pdf-estado").textContent = "Leyendo el PDF…";
    try { vista.pdf = await leerPdf(t.files[0]); pintar(); }
    catch (err) { $("pdf-estado").textContent = `No se pudo leer el PDF: ${(err as Error).message}`; }
    return;
  }
  if (t.dataset.vista) {
    (vista as any)[t.dataset.vista] = t.type === "checkbox" ? t.checked : t.value;
    pintar();
  } else if (t.dataset.masivo) {
    const k = t.dataset.masivo as keyof typeof vista.masivo;
    (vista.masivo as any)[k] = k === "pct" || k === "redondeo" ? Number(t.value) : t.value;
    pintar();
  } else if (t.dataset.campo) {
    const p = est.productos.find((x) => x.codigo === t.closest<HTMLElement>("[data-codigo]")!.dataset.codigo)!;
    (p as any)[t.dataset.campo] = t.dataset.campo === "nombre" ? t.value : Math.max(0, Math.round(Number(t.value) || 0));
    pintar();
  } else if (t.dataset.negocio) {
    fijarRuta(est.negocio, t.dataset.negocio, t.type === "number" ? Number(t.value) || 0 : t.value);
    pintar();
  } else if (t.dataset.kit) {
    const [i, j, k] = t.dataset.kit.split(".").map(Number);
    est.negocio.kits[i].items[j][k] = k === 0 ? t.value.trim().toUpperCase() : Math.max(1, Number(t.value) || 1);
    pintar();
  } else if (t.dataset.kitId) {
    const i = Number(t.dataset.kitId);
    const id = t.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (id && !est.negocio.kits.some((k: any, j: number) => j !== i && k.id === id)) {
      const viejo = est.negocio.kits[i].id;
      est.negocio.kits[i].id = id;
      est.negocio.qr.forEach((q: any) => { if (q.destino === `kit/${viejo}`) q.destino = `kit/${id}`; });
    } else avisar("Esa dirección ya existe o está vacía.");
    pintar();
  } else if (t.dataset.kitExtras) {
    est.negocio.kits[Number(t.dataset.kitExtras)].extras = t.value.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    pintar();
  } else if (t.matches("[data-destacados]")) {
    est.negocio.destacados = t.value.split(/\s+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    pintar();
  }
});

let esperaBusqueda: ReturnType<typeof setTimeout>;
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.vista === "busca") {
    vista.busca = t.value;
    clearTimeout(esperaBusqueda);
    const pos = t.selectionStart;
    esperaBusqueda = setTimeout(() => {
      pintar();
      const nuevo = document.querySelector<HTMLInputElement>('[data-vista="busca"]');
      nuevo?.focus();
      if (pos !== null) nuevo?.setSelectionRange(pos, pos);
    }, 200);
  }
});

$("form-conexion").addEventListener("submit", conectar);
$("modo-prueba").addEventListener("click", () => { est.prueba = true; abrirPanel("Modo prueba · nada se guarda"); });
$("guardar").addEventListener("click", guardar);
$("ver-json").addEventListener("click", verResultado);
$("descartar").addEventListener("click", descartar);
$("dialogo-cerrar").addEventListener("click", () => $<HTMLDialogElement>("dialogo").close());
window.addEventListener("beforeunload", (e) => { if (pendientes().length && !est.prueba) e.preventDefault(); });

// Datos de conexión recordados
const repoGuardado = leer("dh-admin-repo");
try { if (repoGuardado) Object.assign(est, JSON.parse(repoGuardado)); } catch { /* ignorar */ }
$<HTMLInputElement>("c-repo").value = est.repo;
$<HTMLInputElement>("c-rama").value = est.rama;
const tokenGuardado = leer("dh-admin-token");
if (tokenGuardado) { $<HTMLInputElement>("c-token").value = tokenGuardado; $<HTMLInputElement>("c-recordar").checked = true; }

(window as any).DobleHojaAdmin = { leerLineas, est };
