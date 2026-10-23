import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./web'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./web/src'),
      '@shared': r('./shared'),
    },
  },
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5178', changeOrigin: true },
      '/mcp': { target: 'http://127.0.0.1:5178', changeOrigin: true },
    },
  },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
