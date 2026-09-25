/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
      manifest: {
        name: 'Almacén',
        short_name: 'Almacén',
        description: 'Caja, stock y equipo para almacenes, kioscos y bares',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#c8102e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5273, proxy: { '/api': 'http://localhost:3200' } },
  preview: { port: 4273, proxy: { '/api': 'http://localhost:3200' } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
