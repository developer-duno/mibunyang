import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react: reactPlugin, 'react-hooks': reactHooks },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'react-hooks/refs': 'warn',
      // set-state-in-effect: 경고 10건이 모두 AbortController 기반 비동기 데이터
      // 페칭 등 정당한 패턴 (useHistoryData 팩토리 등). React 19 실험 룰이 이 훅
      // 아키텍처에 과민 → off. ref 안티패턴은 react-hooks/refs 가 계속 잡음.
      'react-hooks/set-state-in-effect': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // M0 에서는 추가 룰 없음. parser 적용만으로 충분.
    },
  },
  { ignores: ['dist/', 'node_modules/', 'api/', 'scripts/', 'supabase/', '.vercel/', 'naver-apt/', 'tmp/'] },
];
