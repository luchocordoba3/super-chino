// Convierte los enlaces absolutos ("/lista.html", "/recursos/...") en relativos para que el
// sitio funcione servido desde cualquier carpeta (vista previa). Uso: node scripts/relativizar.mjs dist-vista
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";

const raiz = process.argv[2] ?? "dist-vista";
const archivos = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? archivos(join(dir, n)) : [join(dir, n)]));

let cambiados = 0;
for (const f of archivos(raiz)) {
  if (f.endsWith(".html")) {
    const nivel = relative(raiz, dirname(f)).split(sep).filter(Boolean).length;
    const prefijo = nivel ? "../".repeat(nivel) : "./";
    const html = readFileSync(f, "utf8").replace(/(href|src)="\/(?!\/)([^"]*)"/g, (_m, a, p) => `${a}="${prefijo}${p}"`);
    writeFileSync(f, html);
    cambiados++;
  } else if (f.endsWith(".css")) {
    writeFileSync(f, readFileSync(f, "utf8").replace(/url\(\/[\w-]+\//g, "url(./"));
  }
}
console.log(`${cambiados} páginas con enlaces relativos en ${raiz}`);
