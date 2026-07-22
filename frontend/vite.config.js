// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '../utils/api.js': process.env.VITE_USE_MOCK === 'true'
        ? path.resolve('./src/utils/api.mock.js')
        : path.resolve('./src/utils/api.js'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target:       'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});