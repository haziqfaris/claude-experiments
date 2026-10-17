import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const hub = `http://127.0.0.1:${process.env.SOUL_PORT ?? 7777}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: { '/api': { target: hub, changeOrigin: true } },
  },
});
