(() => {
  "use strict";

  const C = window.CONFIG;
  const PRODUCTOS = window.PRODUCTOS || [];
  const porCodigo = new Map(PRODUCTOS.map((p) => [p.codigo, p]));
  const $ = (id) => document.getElementById(id);
  const plata = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const $$ = (n) => plata.format(n);

  // Rubros en el orden de la lista, con nombre corto para chips y filtros.
  const RUBROS = [
    { id: "QUÍMICOS Y LIMPIEZA", corto: "Químicos", ej: "Lavandina, detergente y desengrasante en bidón de 5 L" },
    { id: "ARTÍCULOS DE LIMPIEZA", corto: "Artículos de limpieza", ej: "Escobillones, secadores, mopas, baldes y trapos" },
    { id: "BOLSAS", corto: "Bolsas", ej: "Consorcio, residuos, camisetas y bobinas de arranque" },
    { id: "PAPEL HIGIÉNICO, TOALLAS Y SERVILLETAS", corto: "Papel y servilletas", ej: "Higiénico institucional, toallas intercaladas y servilletas" },
    { id: "DESCARTABLES GASTRONÓMICOS", corto: "Descartables", ej: "Vasos, bandejas, cubiertos, envases y blondas" },
    { id: "EMBALAJE, PAPELES Y LIBRERÍA", corto: "Embalaje", ej: "Film, cintas, papel kraft, manteca y resmas" },
  ];
  const corto = Object.fromEntries(RUBROS.map((r) => [r.id, r.corto]));

  // ---------- Estado del pedido (se recuerda en este navegador) ----------
  const CLAVE = "papelera-pedido-v1";
  let pedido = {};
  try { pedido = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { pedido = {}; }
  for (const cod of Object.keys(pedido)) if (!porCodigo.has(cod) || !(pedido[cod] > 0)) delete pedido[cod];
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(pedido)); } catch { /* sin almacenamiento */ } };

  let filtroRubro = "";
  let busqueda = "";

  const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const indice = new Map(PRODUCTOS.map((p) => [p.codigo, normal(`${p.codigo} ${p.nombre}`)]));
  const nombreLindo = (s) => s.toLowerCase().replace(/(^|[\s(/])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(X|Cc|Ml|Lt|Lts|Mm|Cm|Mts|Kg|Gr|Grs|Und|Unid|Uni|Un|U|De|Del|Con|Para|P|Y)\b\.?/g, (m) => m.toLowerCase())
    .replace(/\b(Pp|Pet|Pvc|Wc|Fsc|Tbe|Cs|Sf|Mmm|Sh|Bn|Pl)\b/g, (m) => m.toUpperCase()).replace(/\b([SC])\/([hg])\b/gi, (m, a, b) => `${a.toUpperCase()}/${b.toUpperCase()}`);

  // ---------- Cálculos ----------
  function calcular() {
    const lineas = Object.entries(pedido).map(([cod, cant]) => ({ p: porCodigo.get(cod), cant }));
    const subMayor = lineas.reduce((s, l) => s + l.p.mayorista * l.cant, 0);
    const subSuelto = lineas.reduce((s, l) => s + l.p.minorista * l.cant, 0);
    const esMayor = subMayor >= C.minimoMayorista;
    const subtotal = esMayor ? subMayor : subSuelto;
    const unidades = lineas.reduce((s, l) => s + l.cant, 0);
    const envioSinCargo = subtotal >= C.envioSinCargoDesde;
    return { lineas, subMayor, subSuelto, esMayor, subtotal, unidades, envioSinCargo, ahorro: subSuelto - subMayor };
  }

  // ---------- Textos que vienen de la configuración ----------
  function aplicarConfig() {
    document.querySelectorAll("[data-config]").forEach((el) => { el.textContent = C[el.dataset.config] || ""; });
    document.title = C.nombre;
    $("ficha-articulos").textContent = PRODUCTOS.length;
    $("ficha-minimo").textContent = $$(C.minimoMayorista);
    $("ficha-envio").textContent = $$(C.envioSinCargoDesde);
    const mes = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    $("mes-lista").textContent = "· " + mes;
    $("regla-mayor").innerHTML = `<strong>Precio por mayor</strong> en pedidos desde ${$$(C.minimoMayorista)}. Debajo de ese monto rige el precio suelto.`;
    $("reparto-envio").textContent = `Envío sin cargo desde ${$$(C.envioSinCargoDesde)}.`;
    $("tabla-reparto").innerHTML = C.reparto.map((r) => `<tr><td>${r.dias}</td><td>${r.zona}</td><td>${r.barrios}</td></tr>`).join("");
    $("cotizar").href = linkWhatsApp(`Hola, quiero una cotización para mi negocio.`);
    if (C.whatsapp) {
      const n = C.whatsapp.replace(/^549?/, "");
      $("pie-whatsapp").innerHTML = `WhatsApp <a href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener">${n}</a>`;
    }
    if (C.instagram) $("pie-instagram").innerHTML = `Instagram <a href="https://instagram.com/${C.instagram}" target="_blank" rel="noopener">@${C.instagram}</a>`;
  }

  function linkWhatsApp(texto) {
    return `https://wa.me/${C.whatsapp || ""}?text=${encodeURIComponent(texto)}`;
  }

  // ---------- Rubros y chips ----------
  function pintarRubros() {
    const cuenta = {};
    PRODUCTOS.forEach((p) => { cuenta[p.rubro] = (cuenta[p.rubro] || 0) + 1; });
    $("rubros").innerHTML = RUBROS.map((r) => `
      <li><button class="rubro" type="button" data-rubro="${r.id}">
        <span class="rubro__n">${cuenta[r.id] || 0} artículos</span>
        <span class="rubro__nombre">${r.corto}</span>
        <span class="rubro__ej">${r.ej}</span>
      </button></li>`).join("");
    $("chips").innerHTML = [`<button class="chip" type="button" data-rubro="" aria-pressed="true">Todo<span>${PRODUCTOS.length}</span></button>`]
      .concat(RUBROS.map((r) => `<button class="chip" type="button" data-rubro="${r.id}" aria-pressed="false">${r.corto}<span>${cuenta[r.id] || 0}</span></button>`))
      .join("");
  }

  function elegirRubro(id, irAlCatalogo) {
    filtroRubro = id;
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.rubro === id)));
    pintarLista();
    if (irAlCatalogo) $("catalogo").scrollIntoView({ behavior: "smooth" });
  }

  // ---------- Kits ----------
  function pintarKits() {
    $("lista-kits").innerHTML = C.kits.map((k) => {
      const items = k.items.filter(([cod]) => porCodigo.has(cod));
      const mayor = items.reduce((s, [cod, n]) => s + porCodigo.get(cod).mayorista * n, 0);
      const esMayor = mayor >= C.minimoMayorista;
      const total = esMayor ? mayor : items.reduce((s, [cod, n]) => s + porCodigo.get(cod).minorista * n, 0);
      return `
      <article class="kit">
        <header class="kit__cabeza">
          <h3 class="kit__rubro">${k.rubro}</h3>
          <p class="kit__para">${k.para}</p>
        </header>
        <ul class="kit__items">
          ${items.map(([cod, n]) => `<li><span class="kit__cant">${n}×</span><span>${nombreLindo(porCodigo.get(cod).nombre)}</span></li>`).join("")}
        </ul>
        <footer class="kit__pie">
          <p class="kit__precio"><small>${items.length} artículos · ${esMayor ? "precio por mayor" : "precio suelto"}</small><strong>${$$(total)}</strong></p>
          <button class="kit__boton" type="button" data-kit="${k.id}">Agregar kit</button>
        </footer>
      </article>`;
    }).join("");
  }

  function agregarKit(id) {
    const k = C.kits.find((x) => x.id === id);
    if (!k) return;
    k.items.forEach(([cod, n]) => { if (porCodigo.has(cod)) pedido[cod] = (pedido[cod] || 0) + n; });
    cambio();
    avisar(`Kit ${k.rubro} agregado al pedido`);
  }

  // ---------- Lista de precios ----------
  function filaHTML(p) {
    const cant = pedido[p.codigo] || 0;
    return `
    <div class="fila${cant ? " en-pedido" : ""}" role="row" data-codigo="${p.codigo}">
      <span class="fila__cod" role="cell">${p.codigo}</span>
      <span class="fila__nombre" role="cell">${nombreLindo(p.nombre)}</span>
      <span class="fila__precios">
        <span class="fila__mayor" role="cell"><span class="fila__etq">x mayor</span><span class="sticker">${$$(p.mayorista)}</span></span>
        <span class="fila__suelto num" role="cell"><span class="fila__etq">suelto</span>${$$(p.minorista)}</span>
      </span>
      <span class="cantidad" role="cell">
        <button type="button" data-paso="-1" aria-label="Quitar uno de ${p.codigo}">−</button>
        <input type="number" inputmode="numeric" min="0" step="1" value="${cant || ""}" placeholder="0" aria-label="Cantidad de ${p.codigo}" id="c-${p.codigo}">
        <button type="button" data-paso="1" aria-label="Agregar uno de ${p.codigo}">+</button>
      </span>
    </div>`;
  }

  function pintarLista() {
    const q = normal(busqueda.trim()).split(/\s+/).filter(Boolean);
    const visibles = PRODUCTOS.filter((p) =>
      (!filtroRubro || p.rubro === filtroRubro) && q.every((t) => indice.get(p.codigo).includes(t)));
    let html = "";
    for (const r of RUBROS) {
      const del = visibles.filter((p) => p.rubro === r.id);
      if (!del.length) continue;
      html += `<div class="grupo" role="row"><span role="cell">${r.corto}</span><small role="cell">${del.length} artículos</small></div>`;
      html += del.map(filaHTML).join("");
    }
    $("filas").innerHTML = html;
    $("vacia").hidden = visibles.length > 0;
  }

  function fijarCantidad(cod, n) {
    n = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
    if (n) pedido[cod] = n; else delete pedido[cod];
    cambio(cod);
  }

  // ---------- Pedido ----------
  const numeroPedido = (() => {
    const d = new Date();
    const dd = (x) => String(x).padStart(2, "0");
    return `0001-${dd(d.getDate())}${dd(d.getMonth() + 1)}${dd(d.getHours())}${dd(d.getMinutes())}`;
  })();

  function textoPedido(r) {
    const f = new FormData($("datos"));
    const precio = (p) => (r.esMayor ? p.mayorista : p.minorista);
    const renglones = r.lineas.map((l) => `• ${l.cant} × ${l.p.nombre} (${l.p.codigo}) — ${$$(precio(l.p) * l.cant)}`);
    return [
      `Hola! Te paso el pedido N.º ${numeroPedido}:`,
      "",
      ...renglones,
      "",
      `Subtotal (${r.esMayor ? "precio por mayor" : "precio suelto"}): ${$$(r.subtotal)}`,
      `Envío: ${r.envioSinCargo ? "sin cargo" : "a coordinar"}`,
      "",
      `Negocio: ${f.get("negocio") || "-"}`,
      `Dirección: ${f.get("direccion") || "-"}`,
      f.get("cuit") ? `CUIT/DNI: ${f.get("cuit")}` : null,
      `Pago: ${f.get("pago")}`,
      f.get("nota") ? `Aclaraciones: ${f.get("nota")}` : null,
    ].filter((x) => x !== null).join("\n");
  }

  function pintarPedido() {
    const r = calcular();
    const hay = r.lineas.length > 0;
    $("contador").textContent = r.unidades;
    $("remito-vacio").hidden = hay;
    $("renglones").hidden = !hay;
    $("totales").hidden = !hay;
    $("datos").hidden = !hay;
    $("umbral").hidden = !hay;
    $("barra-total").hidden = !hay;

    const avance = Math.min(1, r.subMayor / C.minimoMayorista);
    $("umbral").classList.toggle("listo", r.esMayor);
    $("umbral-avance").style.width = `${Math.round(avance * 100)}%`;
    $("umbral-texto").textContent = r.esMayor
      ? `Tu pedido tiene precio por mayor.`
      : `Te faltan ${$$(C.minimoMayorista - r.subMayor)} para el precio por mayor.`;

    const precio = (p) => (r.esMayor ? p.mayorista : p.minorista);
    $("renglones-cuerpo").innerHTML = r.lineas.map((l) => `
      <tr>
        <td class="num">${l.cant}</td>
        <td>${nombreLindo(l.p.nombre)}<span class="r-cod">${l.p.codigo} · ${$$(precio(l.p))} c/u</span></td>
        <td class="num">${$$(precio(l.p) * l.cant)}</td>
        <td><button class="quitar" type="button" data-quitar="${l.p.codigo}" aria-label="Quitar ${l.p.codigo}">×</button></td>
      </tr>`).join("");
    $("tipo-precio").textContent = r.esMayor ? "por mayor" : "suelto";
    $("subtotal").textContent = $$(r.subtotal);
    $("envio").textContent = r.envioSinCargo ? "Sin cargo" : "A coordinar";
    $("total").textContent = $$(r.subtotal);
    $("ahorro-fila").hidden = !r.esMayor;
    $("ahorro").textContent = $$(r.ahorro);

    $("barra-n").textContent = `${r.unidades} ${r.unidades === 1 ? "unidad" : "unidades"} · ${r.esMayor ? "por mayor" : "suelto"}`;
    $("barra-monto").textContent = $$(r.subtotal);
    $("enviar").href = linkWhatsApp(textoPedido(r));
  }

  function cambio(cod) {
    guardar();
    pintarPedido();
    if (cod) {
      const fila = document.querySelector(`.fila[data-codigo="${cod}"]`);
      if (fila) {
        fila.classList.toggle("en-pedido", Boolean(pedido[cod]));
        const inp = fila.querySelector("input");
        if (document.activeElement !== inp) inp.value = pedido[cod] || "";
      }
    } else {
      pintarLista();
    }
    const b = $("abrir-pedido");
    b.classList.remove("salta");
    void b.offsetWidth;
    b.classList.add("salta");
  }

  let ultimoFoco = null;
  function abrirPedido() {
    ultimoFoco = document.activeElement;
    $("velo").hidden = false;
    const p = $("pedido");
    p.classList.add("abierto");
    p.setAttribute("aria-hidden", "false");
    p.focus();
  }
  function cerrarPedido() {
    $("velo").hidden = true;
    const p = $("pedido");
    p.classList.remove("abierto");
    p.setAttribute("aria-hidden", "true");
    if (ultimoFoco) ultimoFoco.focus();
  }

  let temporizador;
  function avisar(msg) {
    const a = $("aviso");
    a.textContent = msg;
    a.classList.add("visible");
    clearTimeout(temporizador);
    temporizador = setTimeout(() => a.classList.remove("visible"), 2200);
  }

  function validar() {
    let ok = true;
    for (const id of ["d-negocio", "d-direccion"]) {
      const el = $(id);
      const vacio = !el.value.trim();
      el.setAttribute("aria-invalid", String(vacio));
      if (vacio && ok) { el.focus(); ok = false; }
    }
    $("datos-error").hidden = ok;
    return ok;
  }

  // ---------- Eventos ----------
  function conectar() {
    $("rubros").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rubro]");
      if (b) elegirRubro(b.dataset.rubro, true);
    });
    $("chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rubro]");
      if (b) elegirRubro(b.dataset.rubro, false);
    });
    let espera;
    $("buscar").addEventListener("input", (e) => {
      clearTimeout(espera);
      espera = setTimeout(() => { busqueda = e.target.value; pintarLista(); }, 120);
    });
    $("lista-kits").addEventListener("click", (e) => {
      const b = e.target.closest("[data-kit]");
      if (b) agregarKit(b.dataset.kit);
    });
    $("filas").addEventListener("click", (e) => {
      const b = e.target.closest("[data-paso]");
      if (!b) return;
      const cod = b.closest(".fila").dataset.codigo;
      fijarCantidad(cod, (pedido[cod] || 0) + Number(b.dataset.paso));
    });
    $("filas").addEventListener("change", (e) => {
      if (e.target.matches("input")) fijarCantidad(e.target.closest(".fila").dataset.codigo, e.target.value);
    });
    $("filas").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("input")) e.target.blur();
    });

    $("abrir-pedido").addEventListener("click", abrirPedido);
    $("abrir-pedido-2").addEventListener("click", abrirPedido);
    $("cerrar-pedido").addEventListener("click", cerrarPedido);
    $("velo").addEventListener("click", cerrarPedido);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("velo").hidden) cerrarPedido(); });

    $("renglones-cuerpo").addEventListener("click", (e) => {
      const b = e.target.closest("[data-quitar]");
      if (b) { delete pedido[b.dataset.quitar]; cambio(); }
    });
    $("datos").addEventListener("input", (e) => {
      if (e.target.getAttribute("aria-invalid") === "true" && e.target.value.trim()) e.target.setAttribute("aria-invalid", "false");
      $("enviar").href = linkWhatsApp(textoPedido(calcular()));
    });
    $("datos").addEventListener("submit", (e) => e.preventDefault());
    $("enviar").addEventListener("click", (e) => {
      if (!validar()) { e.preventDefault(); return; }
      $("enviar").href = linkWhatsApp(textoPedido(calcular()));
    });
    $("copiar").addEventListener("click", () => {
      const texto = textoPedido(calcular());
      const copiado = () => avisar("Pedido copiado. Pegalo en WhatsApp o en un mail.");
      if (navigator.clipboard) {
        navigator.clipboard.writeText(texto).then(copiado, () => copiarViejo(texto, copiado));
      } else {
        copiarViejo(texto, copiado);
      }
    });
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
      cambio();
    });
  }

  function copiarViejo(texto, listo) {
    const t = document.createElement("textarea");
    t.value = texto;
    t.setAttribute("readonly", "");
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); listo(); } catch { avisar("No se pudo copiar. Seleccioná el texto a mano."); }
    t.remove();
  }

  // ---------- Inicio ----------
  aplicarConfig();
  pintarRubros();
  pintarKits();
  pintarLista();
  $("remito-numero").textContent = numeroPedido;
  $("remito-fecha").textContent = new Date().toLocaleDateString("es-AR");
  pintarPedido();
  conectar();
})();
