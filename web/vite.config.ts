import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    // GitHub Pages のデモ版はリポジトリ名のサブパスで公開される
    base: env.VITE_BASE || '/',
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: { manualChunks: { recharts: ['recharts'], react: ['react', 'react-dom'] } },
      },
    },
    server: {
      // リポジトリ直下の fixtures/demo.json を読み込むため
      fs: { allow: ['..'] },
      // ローカル開発では API（uvicorn :8080）に転送する
      proxy: { '/api': 'http://localhost:8080' },
    },
  };
});
