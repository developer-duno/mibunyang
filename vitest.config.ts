import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.{js,jsx,ts,tsx}',
      'api/**/*.test.{js,jsx,ts,tsx}',
      'scripts/**/*.test.{js,mjs,ts,mts}',
    ],
    setupFiles: ['./src/__tests__/setup.js'],
    // @ts-expect-error vitest 4 타입에서 environmentMatchGlobs 가 deprecated 됐으나 런타임 동작 유지를 위해 보존. 추후 projects 패턴으로 마이그레이션 예정 (BACKLOG)
    environmentMatchGlobs: [
      ['api/**/*.test.{js,jsx,ts,tsx}', 'node'],
      ['scripts/**/*.test.{js,mjs,ts,mts}', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/**/*.test.{js,jsx,ts,tsx}', 'src/__tests__/**'],
    },
  },
});
