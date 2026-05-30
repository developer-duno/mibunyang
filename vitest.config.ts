import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/**/*.test.{js,jsx,ts,tsx}', 'src/__tests__/**'],
    },
    // vitest 4 에서 environmentMatchGlobs 제거됨 → projects 로 환경 분기.
    // 공통 옵션(plugins/alias/globals/setupFiles/coverage)은 루트에 두고
    // extends: true 로 각 project 에 상속. (setup.js 는 typeof window 가드로 node 안전)
    projects: [
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.{js,jsx,ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'api/**/*.test.{js,jsx,ts,tsx}',
            'scripts/**/*.test.{js,mjs,ts,mts}',
          ],
        },
      },
    ],
  },
});
