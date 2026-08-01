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
    // Explicit host binding — without this, Vite binds to the bare
    // hostname "localhost", and Node resolves that via the OS. On this
    // machine that resolves to the IPv6 loopback (::1) ONLY, not
    // 127.0.0.1 (confirmed via netstat: the dev server was reachable
    // on ::1 but refused connections on 127.0.0.1 outright). Any
    // client - a browser, a proxy, a VPN's split-tunnel resolver - that
    // resolves "localhost" to 127.0.0.1 instead gets ECONNREFUSED for
    // every request, including the WebSocket upgrade Socket.IO needs.
    // `host: true` binds the wildcard address instead, so the dev
    // server is reachable on both stacks regardless of which one a
    // given client's "localhost" resolves to.
    host: true,
    proxy: {
      '/api': {
        target:       'https://code-ground-l0gr.onrender.com',
        changeOrigin: true,
      },
      '/socket.io': {
        target:       'https://code-ground-l0gr.onrender.com',
        changeOrigin: true,
        ws:           true,
      },
    },
  },
});