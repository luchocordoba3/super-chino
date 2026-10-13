// Asistente de kits por negocio y armado de kits a medida.
import { productos as P, precios, minimoMayorista, calcular, agregarVarios, registrarRubro, abrir } from "./pedido";
import { svgPictograma } from "../lib/pictogramas";

type Kit = { id: string; rubro: string; items: [string, number][]; extras: string[] };
const D = JSON.parse(document.getElementById("datos-pedido")!.textContent || "{}");
const KITS: Kit[] = D.kits;
const plata = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const $$ = (n: number) => plata.format(n);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ico = (nombre: string) => svgPictograma(nombre);

// Kits a medida en edición, uno por bloque.
const medidas = new Map<string, Map<string, number>>();

function pintarMedida(bloque: HTMLElement) {
  const id = bloque.dataset.kitInicial!;
  const kit = KITS.find((k) => k.id === id)!;
  const m = medidas.get(id)!;
  const lineas = [...m].filter(([c]) => P[c]);
  const mayor = lineas.reduce((s, [c, n]) => s + precios(c)[0] * n, 0);
  const enPedido = calcular().subMayor;
  const conPedido = mayor + enPedido;
  const falta = Math.max(0, minimoMayorista - conPedido);
  const pct = Math.min(100, Math.round((conPedido / minimoMayorista) * 100));
  const extras = kit.extras.filter((c) => P[c] && P[c][5] !== "sin-stock" && !m.has(c));
  const cont = bloque.querySelector<HTMLElement>('[data-vista="medida"]')!;
  cont.innerHTML = `
    <div class="medida">
      <ul class="medida__items">
        ${lineas.map(([c, n]) => `<li data-medida-cod="${c}">
          <span class="kit__icono">${ico(P[c][3])}</span>
          <span class="medida__nombre">${esc(P[c][0])}<small>${$$(precios(c)[0])} c/u por mayor</small></span>
          <span class="cantidad cantidad--chica"><button type="button" data-medida-paso="-1" aria-label="Uno menos">−</button><input type="number" inputmode="numeric" min="0" value="${n}" aria-label="Cantidad de ${esc(P[c][0])}" data-medida-cant><button type="button" data-medida-paso="1" aria-label="Uno más">+</button></span>
          <span class="kit-inicial__sub">${$$(precios(c)[0] * n)}</span>
        </li>`).join("") || `<li class="medida__vacio">Sacaste todo. Sumá artículos de abajo o volvé al kit inicial.</li>`}
      </ul>
      ${extras.length ? `<div class="medida__extras"><p class="sobretitulo">Para tu negocio también suelen llevar</p><ul>
        ${extras.map((c) => `<li><span class="kit__icono">${ico(P[c][3])}</span><span class="medida__nombre">${esc(P[c][0])}<small>${$$(precios(c)[0])} por mayor</small></span><button class="btn-texto" type="button" data-medida-sumar="${c}">+ Sumar</button></li>`).join("")}
      </ul></div>` : ""}
    </div>
    <aside class="kit-inicial__resumen">
      <p class="kit-inicial__total"><small>Tu kit, por mayor</small><strong>${$$(mayor)}</strong></p>
      <div class="medida__barra" role="img" aria-label="Avance hacia el mínimo por mayor: ${pct}%"><span style="width:${pct}%"></span></div>
      <p class="kit-inicial__nota">${falta
        ? `Te faltan <b>${$$(falta)}</b> para el precio por mayor${enPedido ? ", contando lo que ya tenés en el pedido" : ""}.`
        : `Pasás el mínimo de ${$$(minimoMayorista)}${enPedido && mayor < minimoMayorista ? " con lo que ya tenés en el pedido" : ""}: va todo por mayor.`}</p>
      <div class="kit-inicial__acciones">
        <button class="btn btn--cinta" type="button" data-medida-agregar${lineas.length ? "" : " disabled"}>Agregar al pedido</button>
        <button class="btn btn--linea" type="button" data-medida-volver>Volver al kit inicial</button>
      </div>
    </aside>`;
}

function vista(bloque: HTMLElement, cual: "kit" | "medida") {
  bloque.querySelectorAll<HTMLElement>("[data-vista]").forEach((v) => (v.hidden = v.dataset.vista !== cual));
}

function abrirMedida(bloque: HTMLElement) {
  const id = bloque.dataset.kitInicial!;
  const kit = KITS.find((k) => k.id === id)!;
  medidas.set(id, new Map(kit.items.filter(([c]) => P[c] && P[c][5] !== "sin-stock")));
  registrarRubro(id);
  pintarMedida(bloque);
  vista(bloque, "medida");
}

function cambiarCant(bloque: HTMLElement, cod: string, n: number) {
  const m = medidas.get(bloque.dataset.kitInicial!)!;
  n = Math.max(0, Math.min(9999, Math.floor(n) || 0));
  if (n) m.set(cod, n); else m.delete(cod);
  pintarMedida(bloque);
}

// Los totales del kit se recalculan con los precios del día (por si venció una oferta desde la última publicación).
function refrescarKit(bloque: HTMLElement) {
  let mayor = 0, suelto = 0;
  bloque.querySelectorAll<HTMLElement>("[data-kit-linea]").forEach((li) => {
    const [m, s] = precios(li.dataset.kitLinea!);
    const n = Number(li.dataset.n);
    mayor += m * n; suelto += s * n;
    li.querySelector("[data-kit-sub]")!.textContent = $$(m * n);
  });
  bloque.querySelector("[data-kit-total]")!.textContent = $$(mayor);
  bloque.querySelector("[data-kit-suelto]")!.textContent = $$(suelto);
  bloque.querySelector("[data-kit-ahorro]")!.textContent = $$(suelto - mayor);
}
document.querySelectorAll<HTMLElement>("[data-kit-inicial]").forEach(refrescarKit);

// ---------- Asistente: ¿tenés negocio? ¿cuál? ----------
const asistente = document.querySelector<HTMLElement>("[data-asistente]");
const paso = (n: number) => asistente!.querySelector<HTMLElement>(`[data-paso-asistente="${n}"]`)!;

function tiene(si: boolean) {
  asistente!.querySelectorAll<HTMLElement>("[data-tiene]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.tiene === "si") === si)));
  asistente!.querySelector<HTMLElement>("[data-casa]")!.hidden = si;
  paso(2).hidden = !si;
  if (!si) paso(3).hidden = true;
}

function elegirNicho(id: string, enfocar = true) {
  if (!KITS.some((k) => k.id === id)) return;
  tiene(true);
  registrarRubro(id);
  asistente!.querySelectorAll<HTMLElement>("[data-nicho]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.nicho === id));
  asistente!.querySelectorAll<HTMLElement>("[data-panel-nicho]").forEach((p) => {
    p.hidden = p.dataset.panelNicho !== id;
    if (!p.hidden) vista(p.querySelector<HTMLElement>("[data-kit-inicial]")!, "kit");
  });
  paso(3).hidden = false;
  if (enfocar) paso(3).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

if (asistente) {
  const q = new URLSearchParams(location.search).get("kit");
  let guardado: string | null = null;
  try { guardado = localStorage.getItem("doblehoja-rubro"); } catch { /* sin almacenamiento */ }
  if (q && KITS.some((k) => k.id === q)) elegirNicho(q);
  else if (guardado && KITS.some((k) => k.id === guardado)) elegirNicho(guardado, false);
  else paso(2).hidden = true;
}

document.querySelectorAll<HTMLElement>("[data-registrar-rubro]").forEach((el) => registrarRubro(el.dataset.registrarRubro!));

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const si = t.closest<HTMLElement>("[data-tiene]");
  if (si && asistente) { tiene(si.dataset.tiene === "si"); return; }
  const nicho = t.closest<HTMLAnchorElement>("a[data-nicho]");
  if (nicho && asistente && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey) { e.preventDefault(); elegirNicho(nicho.dataset.nicho!); return; }
  if (t.closest("[data-cambiar-nicho]") && asistente) {
    paso(3).hidden = true;
    paso(2).scrollIntoView({ block: "start" });
    return;
  }
  if (t.closest("[data-kit-abrir]")) { setTimeout(abrir, 350); return; }

  const bloque = t.closest<HTMLElement>("[data-kit-inicial]");
  if (!bloque) return;
  if (t.closest("[data-a-medida]")) { abrirMedida(bloque); return; }
  if (t.closest("[data-medida-volver]")) { vista(bloque, "kit"); return; }
  const pasoBtn = t.closest<HTMLElement>("[data-medida-paso]");
  if (pasoBtn) {
    const cod = pasoBtn.closest<HTMLElement>("[data-medida-cod]")!.dataset.medidaCod!;
    cambiarCant(bloque, cod, (medidas.get(bloque.dataset.kitInicial!)!.get(cod) || 0) + Number(pasoBtn.dataset.medidaPaso));
    bloque.querySelector<HTMLElement>(`[data-medida-cod="${cod}"] [data-medida-paso="${pasoBtn.dataset.medidaPaso}"]`)?.focus();
    return;
  }
  const sumar = t.closest<HTMLElement>("[data-medida-sumar]");
  if (sumar) { cambiarCant(bloque, sumar.dataset.medidaSumar!, 1); return; }
  if (t.closest("[data-medida-agregar]")) {
    const id = bloque.dataset.kitInicial!;
    const kit = KITS.find((k) => k.id === id)!;
    agregarVarios([...medidas.get(id)!], `Tu kit de ${kit.rubro.toLowerCase()} está en el pedido`);
    vista(bloque, "kit");
    setTimeout(abrir, 350);
  }
});

document.addEventListener("change", (e) => {
  const inp = (e.target as HTMLElement).closest<HTMLInputElement>("[data-medida-cant]");
  if (!inp) return;
  const bloque = inp.closest<HTMLElement>("[data-kit-inicial]")!;
  cambiarCant(bloque, inp.closest<HTMLElement>("[data-medida-cod]")!.dataset.medidaCod!, Number(inp.value));
});

// Si el pedido cambia mientras se arma un kit a medida, se recalcula el faltante.
document.addEventListener("pedido:cambio", () => {
  document.querySelectorAll<HTMLElement>("[data-kit-inicial]").forEach((b) => {
    if (medidas.has(b.dataset.kitInicial!) && !b.querySelector<HTMLElement>('[data-vista="medida"]')!.hidden) pintarMedida(b);
  });
});
