/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Sabor de la app: Super Chino (supermercado) o Celu Control (casa de celulares).
const celu = process.env.VITE_FLAVOR === 'celulares';
const brand = celu
  ? { name: 'Celu Control', description: 'Caja, equipos con IMEI, servicio técnico y pedidos para casas de celulares', color: '#1f5fd1' }
  : { name: 'Super Chino', description: 'Caja, stock y equipo para supermercados', color: '#c8102e' };

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'flavor-html',
      transformIndexHtml: (html) => html.replace('<title>Super Chino</title>', `<title>${brand.name}</title>`).replace('content="#c8102e"', `content="${brand.color}"`),
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
      manifest: {
        name: brand.name,
        short_name: brand.name,
        description: brand.description,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: brand.color,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3000' } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
