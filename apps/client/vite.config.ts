import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Budget from ARCHITECTURE §3.6: < 200KB gzipped initial JS.
    // CI fails the build if a chunk crosses this.
    chunkSizeWarningLimit: 600,
  },
  server: { port: 5173 },
});
