// Pedido compartido por todas las páginas: se guarda en el navegador y se envía por WhatsApp.
type Datos = {
  productos: Record<string, [string, number, number, string, string]>;
  kits: { id: string; rubro: string; items: [string, number][] }[];
  minimoMayorista: number;
  envioSinCargoDesde: number;
  whatsapp: string;
  nombre: string;
};

const D: Datos = JSON.parse(document.getElementById("datos-pedido")!.textContent || "{}");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const plata = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const $$ = (n: number) => plata.format(n);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CLAVE = "doblehoja-pedido-v1";
let pedido: Record<string, number> = {};
try { pedido = JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch { pedido = {}; }
for (const c of Object.keys(pedido)) if (!D.productos[c] || !(pedido[c] > 0)) delete pedido[c];
const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(pedido)); } catch { /* sin almacenamiento */ } };

export function calcular() {
  const lineas = Object.entries(pedido).map(([codigo, cant]) => {
    const [titulo, mayorista, minorista] = D.productos[codigo];
    return { codigo, cant, titulo, mayorista, minorista };
  });
  const subMayor = lineas.reduce((s, l) => s + l.mayorista * l.cant, 0);
  const subSuelto = lineas.reduce((s, l) => s + l.minorista * l.cant, 0);
  const esMayor = subMayor >= D.minimoMayorista;
  const total = esMayor ? subMayor : subSuelto;
  const unidades = lineas.reduce((s, l) => s + l.cant, 0);
  return { lineas, subMayor, subSuelto, esMayor, total, unidades, envioSinCargo: total >= D.envioSinCargoDesde, ahorro: subSuelto - subMayor };
}

const numero = (() => {
  const d = new Date();
  const dd = (x: number) => String(x).padStart(2, "0");
  return `0001-${dd(d.getDate())}${dd(d.getMonth() + 1)}${dd(d.getHours())}${dd(d.getMinutes())}`;
})();

const linkWhatsApp = (texto: string) => `https://wa.me/${D.whatsapp || ""}?text=${encodeURIComponent(texto)}`;

function textoPedido() {
  const r = calcular();
  const f = new FormData($<HTMLFormElement>("datos-entrega"));
  const precio = (l: (typeof r.lineas)[number]) => (r.esMayor ? l.mayorista : l.minorista);
  return [
    `Hola ${D.nombre}! Te paso el pedido N.º ${numero}:`,
    "",
    ...r.lineas.map((l) => `• ${l.cant} × ${l.titulo} (${l.codigo}) — ${$$(precio(l) * l.cant)}`),
    "",
    `Subtotal (${r.esMayor ? "precio por mayor" : "precio suelto"}): ${$$(r.total)}`,
    `Envío: ${r.envioSinCargo ? "sin cargo" : "a coordinar"}`,
    "",
    `Negocio: ${f.get("negocio") || "-"}`,
    `Dirección: ${f.get("direccion") || "-"}`,
    f.get("cuit") ? `CUIT/DNI: ${f.get("cuit")}` : null,
    `Pago: ${f.get("pago")}`,
    f.get("nota") ? `Aclaraciones: ${f.get("nota")}` : null,
    f.get("mensual") ? "🔁 Quiero repetir este pedido todos los meses." : null,
  ].filter((x) => x !== null).join("\n");
}

function pintar() {
  const r = calcular();
  const hay = r.lineas.length > 0;
  const avance = Math.min(1, r.subMayor / D.minimoMayorista);
  const valores: Record<string, string> = {
    unidades: String(r.unidades),
    total: $$(r.total),
    tipo: r.esMayor ? "por mayor" : "suelto",
    envio: r.envioSinCargo ? "Sin cargo" : "A coordinar",
    ahorro: $$(r.ahorro),
    resumen: `${r.unidades} ${r.unidades === 1 ? "unidad" : "unidades"} · ${r.esMayor ? "por mayor" : "suelto"}`,
    articulos: `${r.lineas.length} ${r.lineas.length === 1 ? "artículo" : "artículos"} · ${r.unidades} u.`,
    "umbral-texto": r.esMayor ? "Tu pedido tiene precio por mayor." : `Te faltan ${$$(D.minimoMayorista - r.subMayor)} para el precio por mayor.`,
  };
  document.querySelectorAll<HTMLElement>("[data-pedido]").forEach((el) => {
    const k = el.dataset.pedido!;
    if (k in valores) el.textContent = valores[k];
    else if (k === "umbral") { el.hidden = !hay; el.classList.toggle("listo", r.esMayor); }
    else if (k === "umbral-barra") el.style.width = `${Math.round(avance * 100)}%`;
    else if (k === "ahorro-fila") el.hidden = !r.esMayor;
    else if (k === "si-hay") el.hidden = !hay;
    else if (k === "si-vacio") el.hidden = hay;
  });

  $("remito-vacio").hidden = hay;
  $("lineas").hidden = !hay;
  $("totales").hidden = !hay;
  $("datos-entrega").hidden = !hay;
  $("barra-total").hidden = !hay;
  const precio = (l: (typeof r.lineas)[number]) => (r.esMayor ? l.mayorista : l.minorista);
  $("lineas-cuerpo").innerHTML = r.lineas.map((l) => `
    <tr>
      <td class="num">${l.cant}</td>
      <td>${esc(l.titulo)}<span class="l-cod">${l.codigo} · ${$$(precio(l))} c/u</span></td>
      <td class="num">${$$(precio(l) * l.cant)}</td>
      <td><button class="quitar" type="button" data-quitar="${l.codigo}" aria-label="Quitar ${l.codigo}">×</button></td>
    </tr>`).join("");
  $<HTMLAnchorElement>("enviar").href = linkWhatsApp(textoPedido());

  document.querySelectorAll<HTMLElement>("[data-cantidad]").forEach((w) => {
    const n = pedido[w.dataset.cantidad!] || 0;
    const inp = w.querySelector("input")!;
    if (document.activeElement !== inp) inp.value = n ? String(n) : "";
    w.closest("[data-producto]")?.classList.toggle("en-pedido", n > 0);
  });
  document.dispatchEvent(new CustomEvent("pedido:cambio", { detail: r }));
}

function cambio(animar = true) {
  guardar();
  pintar();
  if (animar) {
    document.querySelectorAll(".btn-pedido").forEach((b) => {
      b.classList.remove("salta");
      void (b as HTMLElement).offsetWidth;
      b.classList.add("salta");
    });
  }
}

export function fijar(codigo: string, n: number) {
  if (!D.productos[codigo]) return;
  n = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
  if (n) pedido[codigo] = n; else delete pedido[codigo];
  cambio();
}
export const sumar = (codigo: string, n: number) => fijar(codigo, (pedido[codigo] || 0) + n);

let temporizador: ReturnType<typeof setTimeout>;
export function avisar(msg: string, conBoton = true) {
  const a = $("aviso");
  $("aviso-texto").textContent = msg;
  (a.querySelector("button") as HTMLElement).hidden = !conBoton;
  a.classList.add("visible");
  clearTimeout(temporizador);
  temporizador = setTimeout(() => a.classList.remove("visible"), 2600);
}

let ultimoFoco: Element | null = null;
export function abrir() {
  ultimoFoco = document.activeElement;
  $("aviso").classList.remove("visible");
  $("velo").hidden = false;
  const p = $("pedido");
  p.classList.add("abierto");
  p.setAttribute("aria-hidden", "false");
  p.focus();
}
function cerrar() {
  $("velo").hidden = true;
  const p = $("pedido");
  p.classList.remove("abierto");
  p.setAttribute("aria-hidden", "true");
  (ultimoFoco as HTMLElement | null)?.focus?.();
}

function validar() {
  let ok = true;
  for (const id of ["d-negocio", "d-direccion"]) {
    const el = $<HTMLInputElement>(id);
    const vacio = !el.value.trim();
    el.setAttribute("aria-invalid", String(vacio));
    if (vacio && ok) { el.focus(); ok = false; }
  }
  $("datos-error").hidden = ok;
  return ok;
}

function copiar(texto: string) {
  const listo = () => avisar("Pedido copiado. Pegalo en WhatsApp o en un mail.", false);
  const viejo = () => {
    const t = document.createElement("textarea");
    t.value = texto;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); listo(); } catch { avisar("No se pudo copiar. Seleccioná el texto a mano.", false); }
    t.remove();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(texto).then(listo, viejo);
  else viejo();
}

// ---------- Eventos ----------
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const paso = t.closest<HTMLElement>("[data-paso]");
  if (paso) {
    const cod = paso.closest<HTMLElement>("[data-cantidad]")!.dataset.cantidad!;
    const antes = pedido[cod] || 0;
    sumar(cod, Number(paso.dataset.paso));
    if (!antes && pedido[cod]) avisar(`${D.productos[cod][0]} agregado`);
    return;
  }
  const kit = t.closest<HTMLElement>("[data-kit]");
  if (kit) {
    const k = D.kits.find((x) => x.id === kit.dataset.kit);
    if (k) {
      k.items.forEach(([c, n]) => { if (D.productos[c]) pedido[c] = (pedido[c] || 0) + n; });
      cambio();
      avisar(`Kit ${k.rubro} agregado al pedido`);
    }
    return;
  }
  const agregar = t.closest<HTMLElement>("[data-agregar]");
  if (agregar) {
    const cod = agregar.dataset.agregar!;
    const inp = document.querySelector<HTMLInputElement>(`[data-cantidad="${cod}"] input`);
    if (!pedido[cod]) fijar(cod, Number(inp?.value) || 1);
    avisar(`${D.productos[cod][0]} en tu pedido`);
    return;
  }
  if (t.closest("[data-abrir-pedido]")) { abrir(); return; }
  const quitar = t.closest<HTMLElement>("[data-quitar]");
  if (quitar) { delete pedido[quitar.dataset.quitar!]; cambio(false); }
});

document.addEventListener("change", (e) => {
  const inp = e.target as HTMLInputElement;
  const w = inp.closest<HTMLElement>("[data-cantidad]");
  if (w && inp.matches("input")) fijar(w.dataset.cantidad!, Number(inp.value));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("velo").hidden) cerrar();
  const inp = e.target as HTMLElement;
  if (e.key === "Enter" && inp.matches("[data-cantidad] input")) (inp as HTMLInputElement).blur();
});

$("cerrar-pedido").addEventListener("click", cerrar);
$("velo").addEventListener("click", cerrar);
$("datos-entrega").addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.getAttribute("aria-invalid") === "true" && el.value.trim()) el.setAttribute("aria-invalid", "false");
  $<HTMLAnchorElement>("enviar").href = linkWhatsApp(textoPedido());
});
$("datos-entrega").addEventListener("submit", (e) => e.preventDefault());
$("enviar").addEventListener("click", (e) => {
  if (!validar()) { e.preventDefault(); return; }
  $<HTMLAnchorElement>("enviar").href = linkWhatsApp(textoPedido());
});
$("copiar").addEventListener("click", () => copiar(textoPedido()));
$("vaciar").addEventListener("click", () => {
  const b = $("vaciar");
  if (b.dataset.confirmar !== "1") {
    b.dataset.confirmar = "1";
    b.textContent = "Tocá de nuevo para vaciar";
    setTimeout(() => { b.dataset.confirmar = ""; b.textContent = "Vaciar pedido"; }, 3000);
    return;
  }
  pedido = {};
  b.dataset.confirmar = "";
  b.textContent = "Vaciar pedido";
  cambio(false);
});

$("remito-numero").textContent = numero;
$("remito-fecha").textContent = new Date().toLocaleDateString("es-AR");
pintar();

(window as unknown as { DobleHoja: object }).DobleHoja = { fijar, sumar, abrir, avisar, calcular, productos: D.productos, pedido: () => ({ ...pedido }) };

export const productos = D.productos;
export const minimoMayorista = D.minimoMayorista;
export { linkWhatsApp, validarCampos };

function validarCampos(form: HTMLFormElement, errorId: string) {
  let ok = true;
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[required]").forEach((el) => {
    const vacio = !el.value.trim();
    el.setAttribute("aria-invalid", String(vacio));
    if (vacio && ok) { el.focus(); ok = false; }
  });
  document.getElementById(errorId)!.hidden = ok;
  return ok;
}
