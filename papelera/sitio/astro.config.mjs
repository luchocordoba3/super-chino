import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

// La dirección pública sale de negocio.json (editable desde el panel).
const { sitio } = JSON.parse(readFileSync(new URL("./src/datos/negocio.json", import.meta.url), "utf8"));

const vista = process.env.PUBLIC_VISTA === "1";

export default defineConfig({
  site: sitio,
  build: { format: vista ? "file" : "directory", inlineStylesheets: "never", assets: vista ? "recursos" : "_astro" },
  trailingSlash: vista ? "ignore" : "always",
});
