import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['@mysten/walrus-wasm'],
  },
  server: {
    proxy: {
      '/walrus': {
        target: 'https://aggregator.walrus-mainnet.walrus.space/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/walrus/, ''),
      },
    },
  },
});