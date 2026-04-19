import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/sub': 'http://127.0.0.1:8000',
      '/healthz': 'http://127.0.0.1:8000',
      '/metrics': 'http://127.0.0.1:8000',
      '/hy2': 'http://127.0.0.1:8000',
    },
  },
});

