/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND } from './src/brand';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        name: BRAND.name,
        short_name: BRAND.name,
        description: BRAND.description,
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#101216',
        theme_color: '#101216',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5174 },
  preview: { port: 4174 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
