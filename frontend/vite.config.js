import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`            -> dist/ (deployed to Render as a static site)
// `npm run build:standalone` -> ../standalone/index.html (one self-contained file, works offline)
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    build: standalone ? { outDir: '../standalone', emptyOutDir: true } : { outDir: 'dist' },
    server: {
      port: 5173,
      // During development, /api/* is forwarded to the FastAPI backend.
      proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.{js,jsx}'],
    },
  };
});
