import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
            // split heavy 3D libs into their own chunk to avoid bloating vendor
            if (id.includes('three') || id.includes('skin3d') || id.includes('three-stdlib')) return 'vendor-3d';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    // Allow enabling HTTPS in development by setting DEV_HTTPS=true and
    // placing `dev.crt` and `dev.key` next to this config file (or set
    // DEV_HTTPS_CERT / DEV_HTTPS_KEY env vars to alternate paths).
    https: (() => {
      try {
        const useHttps = process.env.DEV_HTTPS === 'true';
        if (!useHttps) return false;
        const certPath = process.env.DEV_HTTPS_CERT || path.resolve(__dirname, 'dev.crt');
        const keyPath = process.env.DEV_HTTPS_KEY || path.resolve(__dirname, 'dev.key');
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          return {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          } as any;
        }
        console.warn('[vite] DEV_HTTPS is set but certificate files not found:', certPath, keyPath);
      } catch (e) {
        console.warn('[vite] failed to load https certs', e);
      }
      return false;
    })(),
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
