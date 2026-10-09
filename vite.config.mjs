import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.UI_PORT || 4390),
    strictPort: true,
    watch: {
      ignored: [
        '**/.data/**',
        '**/.npm-cache/**',
        '**/artifacts/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/.npm-cache/**'],
    },
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VAULT_PORT || 4391}`,
      '/research-api': {
        target: `http://127.0.0.1:${process.env.RESEARCH_PORT || 4392}`,
        rewrite: (p) => p.replace('/research-api', '/api'),
      },
      '/writer-api': {
        target: `http://127.0.0.1:${process.env.WRITER_PORT || 4393}`,
        rewrite: (p) => p.replace('/writer-api', '/api'),
      },
    },
  },
});
