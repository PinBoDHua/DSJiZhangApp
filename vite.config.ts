import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const emptyModule = fileURLToPath(new URL('./src/lib/emptyModule.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // jsPDF 仅在 html() 时用 html2canvas；薪时不用 html()，避免 200KB 无用包。
      html2canvas: emptyModule,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
