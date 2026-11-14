import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the build can be hosted from any sub-path (GitHub Pages, etc.).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'tools/**/*.test.ts'] },
});
