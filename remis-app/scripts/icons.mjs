// Genera los íconos PNG de la app a partir de public/icon.svg (usa el Chromium de Playwright).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
// Ícono "maskable" y el de iPhone: fondo completo y el dibujo más chico, para que no lo recorten.
const full = svg.replace('rx="112"', 'rx="0"').replace('<g id="glyph">', '<g id="glyph" transform="translate(256 290) scale(0.74) translate(-256 -290)">');
const CHROME = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage();
const out = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', full, 512],
  ['apple-touch-icon.png', full, 180],
];
for (const [name, src, size] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
  writeFileSync(new URL(`../public/${name}`, import.meta.url), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log('Íconos listos en public/');
