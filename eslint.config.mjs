// ESLint 9 平面配置（不做类型感知规则；typescript-eslint 用根目录 typescript@5.9 解析）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const files = [
  'apps/desktop/src/**/*.{ts,tsx}',
  'packages/*/src/**/*.ts',
  'packages/*/test/**/*.ts',
  'scripts/**/*.{js,mjs}',
]

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', 'scratch/**', '**/*.d.ts'] },
  {
    files,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: {
      // 第一次接入先降为 warn，后续逐步清零
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off',
      // 闭包先引用、后赋值的 let（如 project-tools 里的 copies）不算
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // renderer：浏览器环境 + hooks 规则
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    // 远端辅助进程会打包的文件（electron.remote.config.ts <- remote-entry.ts 的 import 链）：禁止 electron
    files: [
      'apps/desktop/src/main/machines/remote-*.ts',
      'apps/desktop/src/main/machines/rpc.ts',
      'apps/desktop/src/main/machines/identity.ts',
      'apps/desktop/src/main/project-tools/{common,copies,git,git-parse,services,tasks}.ts',
      'apps/desktop/src/main/workspace-files.ts',
      'apps/desktop/src/main/artifact-files.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: '远端辅助进程不得依赖 electron' }] }],
    },
  },
  {
    // renderer 不应导入 mock/（第三批清零）
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    ignores: ['apps/desktop/src/renderer/src/mock/**'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            { group: ['@/mock', '@/mock/*'], message: 'mock/ 只供演示数据使用，第三批清零' },
            { group: ['**/mock', '**/mock/*'], message: 'mock/ 只供演示数据使用，第三批清零' },
          ],
        },
      ],
    },
  },
)
