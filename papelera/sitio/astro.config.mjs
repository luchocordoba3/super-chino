import { defineConfig } from "astro/config";

const vista = process.env.PUBLIC_VISTA === "1";

export default defineConfig({
  site: "https://doblehoja.com",
  build: { format: vista ? "file" : "directory", inlineStylesheets: "never", assets: vista ? "recursos" : "_astro" },
  trailingSlash: vista ? "ignore" : "always",
});
