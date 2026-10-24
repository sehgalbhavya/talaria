import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Override both to run a second copy next to your everyday one (e.g. to try out a branch).
const api = `http://127.0.0.1:${process.env.TALARIA_PORT || 5178}`;
const webPort = Number(process.env.TALARIA_WEB_PORT || 5177);

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
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/mcp': { target: api, changeOrigin: true },
    },
  },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
