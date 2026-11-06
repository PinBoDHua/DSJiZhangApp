import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const emptyModule = fileURLToPath(new URL('./src/lib/emptyModule.ts', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    // 版本号只认 package.json，避免关于页 / 引导页 / 搬家包各写一份。
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
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
