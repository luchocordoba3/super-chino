// Servidor del panel (Cloudflare Pages Functions). Guarda en GitHub con el token del servidor;
// el navegador solo tiene una cookie de sesión firmada.
export interface Env {
  ADMIN_CLAVE: string;
  SESION_SECRETO: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO?: string;
  GITHUB_RAMA?: string;
  VISTA_PREVIA_URL?: string;
  GITHUB_API?: string; // solo para pruebas
}

const CARPETA = "papelera/sitio/src/datos";
const RUTAS = { negocio: `${CARPETA}/negocio.json`, productos: `${CARPETA}/productos.json` } as const;
type Archivo = keyof typeof RUTAS;
const BORRADOR = "panel-borrador";
const COOKIE = "dh_sesion";
const DURACION = 30 * 24 * 60 * 60; // segundos

const enc = new TextEncoder();
const json = (datos: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
const error = (status: number, mensaje: string) => json({ error: mensaje }, status);
class ErrorPanel extends Error { constructor(public status: number, mensaje: string) { super(mensaje); } }

// ---------- Sesión ----------
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const clave = (secreto: string) => crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function crearSesion(env: Env) {
  const vence = Math.floor(Date.now() / 1000) + DURACION;
  const firma = await crypto.subtle.sign("HMAC", await clave(env.SESION_SECRETO), enc.encode(`panel.${vence}`));
  return `${vence}.${b64url(firma)}`;
}

async function sesionValida(req: Request, env: Env) {
  const valor = (req.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!valor) return false;
  const [vence, firma] = valor.split(".");
  if (!vence || !firma || Number(vence) < Date.now() / 1000) return false;
  try { return await crypto.subtle.verify("HMAC", await clave(env.SESION_SECRETO), deB64url(firma), enc.encode(`panel.${vence}`)); }
  catch { return false; }
}

// Compara la clave sin filtrar por tiempo cuántos caracteres coinciden.
async function claveCorrecta(intento: string, env: Env) {
  const k = await clave(env.SESION_SECRETO);
  const esperada = await crypto.subtle.sign("HMAC", k, enc.encode(env.ADMIN_CLAVE));
  return crypto.subtle.verify("HMAC", k, esperada, enc.encode(intento));
}

const cookie = (valor: string, edad: number) => `${COOKIE}=${valor}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${edad}`;

// ---------- GitHub ----------
async function gh(env: Env, ruta: string, init: RequestInit = {}) {
  const base = (env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");
  const r = await fetch(`${base}/repos/${env.GITHUB_REPO || "luchocordoba3/super-chino"}${ruta}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "doble-hoja-panel",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    if (r.status === 401) throw new ErrorPanel(502, "El token de GitHub del servidor no es válido o venció. Hay que cambiarlo en Cloudflare.");
    if (r.status === 403) throw new ErrorPanel(502, "El token de GitHub del servidor no tiene permiso de escritura en el repositorio.");
    throw Object.assign(new ErrorPanel(502, `GitHub respondió ${r.status}.`), { gh: r.status });
  }
  return r.status === 204 ? null : r.json();
}
const rama = (env: Env) => env.GITHUB_RAMA || "main";
const cabeza = async (env: Env, nombre: string) => ((await gh(env, `/git/ref/heads/${encodeURIComponent(nombre)}`)) as any).object.sha as string;

function decodificar(b64: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}
async function leerArchivo(env: Env, a: Archivo, ref: string) {
  const d = (await gh(env, `/contents/${RUTAS[a]}?ref=${encodeURIComponent(ref)}`)) as any;
  return { texto: decodificar(d.content), sha: d.sha as string };
}

// ---------- Validación ----------
const CODIGO = /^[A-Z]{2}\d{4}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function validar(a: Archivo, texto: string) {
  if (typeof texto !== "string" || texto.length > 2_000_000) throw new ErrorPanel(400, `${a}.json es demasiado grande.`);
  let d: any;
  try { d = JSON.parse(texto); } catch { throw new ErrorPanel(400, `${a}.json no es un JSON válido.`); }
  if (a === "productos") {
    if (!Array.isArray(d) || !d.length) throw new ErrorPanel(400, "La lista de productos está vacía.");
    const vistos = new Set<string>();
    for (const p of d) {
      const ok = p && CODIGO.test(p.codigo) && !vistos.has(p.codigo) && typeof p.nombre === "string" && p.nombre.trim() && typeof p.rubro === "string"
        && Number.isFinite(p.mayorista) && p.mayorista >= 0 && Number.isFinite(p.minorista) && p.minorista >= 0
        && (p.estado === undefined || p.estado === "sin-stock" || p.estado === "a-pedido")
        && (p.oferta === undefined || (Number.isFinite(p.oferta.porcentaje) && p.oferta.porcentaje > 0 && p.oferta.porcentaje < 90 && FECHA.test(p.oferta.hasta)));
      if (!ok) throw new ErrorPanel(400, `Hay un artículo con datos inválidos: ${p?.codigo ?? "(sin código)"}.`);
      vistos.add(p.codigo);
    }
  } else {
    if (!d || typeof d !== "object" || Array.isArray(d) || typeof d.nombre !== "string" || typeof d.whatsapp !== "string" || !Array.isArray(d.kits))
      throw new ErrorPanel(400, "negocio.json no tiene la forma esperada (nombre, whatsapp, kits…).");
  }
}

// ---------- Commits ----------
// Un solo commit con todos los archivos, sobre la punta de la rama principal.
async function commitear(env: Env, archivos: Partial<Record<Archivo, string>>, mensaje: string, padre: string) {
  const commitPadre = (await gh(env, `/git/commits/${padre}`)) as any;
  const tree = await Promise.all((Object.keys(archivos) as Archivo[]).map(async (a) => {
    const blob = (await gh(env, "/git/blobs", { method: "POST", body: JSON.stringify({ content: archivos[a], encoding: "utf-8" }) })) as any;
    return { path: RUTAS[a], mode: "100644", type: "blob", sha: blob.sha };
  }));
  const arbol = (await gh(env, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commitPadre.tree.sha, tree }) })) as any;
  const c = (await gh(env, "/git/commits", { method: "POST", body: JSON.stringify({ message: mensaje, tree: arbol.sha, parents: [padre] }) })) as any;
  return c.sha as string;
}

async function moverBorrador(env: Env, sha: string) {
  try { await gh(env, `/git/refs/heads/${BORRADOR}`, { method: "PATCH", body: JSON.stringify({ sha, force: true }) }); }
  catch (e: any) {
    if (e.gh !== 422 && e.gh !== 404) throw e;
    await gh(env, "/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${BORRADOR}`, sha }) });
  }
}

// ¿Cambiaron los datos en la rama principal desde que el panel los leyó?
async function cambiaronDesde(env: Env, base: string, punta: string, archivos: Archivo[]) {
  if (base === punta) return false;
  for (const a of archivos) {
    const [antes, ahora] = await Promise.all([leerArchivo(env, a, base), leerArchivo(env, a, punta)]);
    if (antes.sha !== ahora.sha) return true;
  }
  return false;
}

async function guardar(env: Env, archivos: Partial<Record<Archivo, string>>, mensaje: string, destino: "vista" | "publicar", base?: string) {
  const nombres = Object.keys(archivos) as Archivo[];
  if (!nombres.length || nombres.some((a) => !(a in RUTAS))) throw new ErrorPanel(400, "No hay archivos válidos para guardar.");
  nombres.forEach((a) => validar(a, archivos[a]!));
  const msj = (mensaje || "Panel: actualiza datos").slice(0, 200);
  for (let intento = 0; intento < 2; intento++) {
    const punta = await cabeza(env, rama(env));
    if (base && await cambiaronDesde(env, base, punta, nombres))
      throw new ErrorPanel(409, "Alguien publicó cambios desde otro dispositivo. Recargá el panel para traer la última versión.");
    const sha = await commitear(env, archivos, msj, punta);
    if (destino === "vista") {
      await moverBorrador(env, sha);
      return { commit: sha, base: punta, vista: env.VISTA_PREVIA_URL || "" };
    }
    try {
      await gh(env, `/git/refs/heads/${rama(env)}`, { method: "PATCH", body: JSON.stringify({ sha, force: false }) });
    } catch (e: any) {
      if (e.gh === 422 && intento === 0) continue; // la rama avanzó en el medio: se rearma sobre la nueva punta
      throw e;
    }
    await moverBorrador(env, sha).catch(() => {});
    return { commit: sha, base: sha, vista: env.VISTA_PREVIA_URL || "" };
  }
  throw new ErrorPanel(409, "No se pudo publicar porque la rama cambió. Probá de nuevo.");
}

async function datos(env: Env) {
  const punta = await cabeza(env, rama(env));
  const [negocio, productos] = await Promise.all([leerArchivo(env, "negocio", punta), leerArchivo(env, "productos", punta)]);
  return { negocio: negocio.texto, productos: productos.texto, base: punta, vista: env.VISTA_PREVIA_URL || "" };
}

async function historial(env: Env) {
  const lista = (await gh(env, `/commits?sha=${encodeURIComponent(rama(env))}&path=${encodeURIComponent(CARPETA)}&per_page=20`)) as any[];
  return lista.map((c) => ({ sha: c.sha, mensaje: String(c.commit.message).split("\n")[0], fecha: c.commit.author?.date || c.commit.committer?.date, autor: c.commit.author?.name || "" }));
}

async function restaurar(env: Env, sha: string) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new ErrorPanel(400, "Versión inválida.");
  const [negocio, productos] = await Promise.all([leerArchivo(env, "negocio", sha), leerArchivo(env, "productos", sha)]);
  const c = (await gh(env, `/git/commits/${sha}`).catch(() => null)) as any;
  const fecha = c?.author?.date ? new Date(c.author.date).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : sha.slice(0, 7);
  return guardar(env, { negocio: negocio.texto, productos: productos.texto }, `Panel: vuelve a la versión del ${fecha}`, "publicar");
}

// ---------- Rutas ----------
export async function manejar(req: Request, env: Env): Promise<Response> {
  const ruta = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (!env.ADMIN_CLAVE || !env.SESION_SECRETO || !env.GITHUB_TOKEN) return error(503, "Faltan configurar las variables del panel en Cloudflare (ADMIN_CLAVE, SESION_SECRETO y GITHUB_TOKEN).");
  // Solo el panel manda este encabezado: un formulario de otro sitio no puede.
  if (req.headers.get("X-Panel") !== "1") return error(403, "Pedido no permitido.");
  try {
    if (ruta === "entrar" && req.method === "POST") {
      const { clave: intento } = (await req.json().catch(() => ({}))) as { clave?: string };
      if (!intento || !(await claveCorrecta(String(intento), env))) {
        await new Promise((r) => setTimeout(r, 1000));
        return error(401, "Contraseña incorrecta.");
      }
      return json({ ok: true, vista: env.VISTA_PREVIA_URL || "" }, 200, { "Set-Cookie": cookie(await crearSesion(env), DURACION) });
    }
    if (ruta === "salir" && req.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    if (!(await sesionValida(req, env))) return error(401, "La sesión venció. Volvé a entrar.");

    if (ruta === "sesion" && req.method === "GET") return json({ ok: true, vista: env.VISTA_PREVIA_URL || "" });
    if (ruta === "datos" && req.method === "GET") return json(await datos(env));
    if (ruta === "historial" && req.method === "GET") return json(await historial(env));
    if (ruta === "guardar" && req.method === "POST") {
      const b = (await req.json().catch(() => null)) as any;
      if (!b || (b.destino !== "vista" && b.destino !== "publicar")) return error(400, "Pedido inválido.");
      return json(await guardar(env, b.archivos || {}, String(b.mensaje || ""), b.destino, b.base));
    }
    if (ruta === "restaurar" && req.method === "POST") {
      const b = (await req.json().catch(() => null)) as any;
      return json(await restaurar(env, String(b?.sha || "")));
    }
    return error(404, "No existe.");
  } catch (e: any) {
    if (e instanceof ErrorPanel) return error(e.status, e.message);
    return error(500, "Error inesperado del servidor.");
  }
}
