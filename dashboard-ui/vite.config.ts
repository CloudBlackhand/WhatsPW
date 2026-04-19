import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Deve coincidir com serveRoot do WAHA (/dashboard).
// Saída em src/dashboard para o Nest copiar assets e para o Dockerfile empacotar.
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: {
    outDir: '../src/dashboard',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_WAHA_DEV_PROXY ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/ping': {
        target: process.env.VITE_WAHA_DEV_PROXY ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_WAHA_DEV_PROXY ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
