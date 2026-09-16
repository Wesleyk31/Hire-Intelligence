import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// Explicit verification build; production remains on vite.config.ts and the real SDK.
export default defineConfig({
  plugins: [react()], base: './',
  resolve: { alias: { '@appdeploy/client': fileURLToPath(new URL('./tests/runtime/client.ts', import.meta.url)) } },
  build: { outDir: '.local/verification-dist' },
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
