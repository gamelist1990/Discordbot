import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, '../../../dist/web'),
    emptyOutDir: true,
    // 出力にソースマップを含めることで、本番の minified エラーでも
    // ブラウザが元のソースとスタックトレースを参照できるようにします。
    // 開発/デバッグ時に true、必要なら 'inline' に変更できます。
    sourcemap: true,
    // 大きなバンドルを分割してチャンクサイズ警告を軽減します。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'vendor-react';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
