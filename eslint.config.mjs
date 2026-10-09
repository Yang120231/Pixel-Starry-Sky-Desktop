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

// 同一文件命中多个配置块时，同名规则由后者整体覆盖（不合并选项），
// 所以 no-restricted-imports 的各组限制在这里合并成一份，避免互相覆盖。
const mainLayerImportPatterns = [
  {
    group: ['**/renderer', '**/renderer/**', '**/preload', '**/preload/**'],
    message: 'main 不得导入 renderer / preload；共享 DTO 放 src/shared',
  },
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
    // main 不导入 renderer / preload（与下面的远端 electron 规则合并在同一个 no-restricted-imports 里）
    files: ['apps/desktop/src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: mainLayerImportPatterns }],
    },
  },
  {
    // 远端辅助进程会打包的文件（electron.remote.config.ts <- remote-entry.ts 的 import 链）：禁止 electron，
    // 同时保留 main 不导入 renderer / preload 的限制（同名规则会整体覆盖，所以两条写在一起）
    files: [
      'apps/desktop/src/main/machines/remote-*.ts',
      'apps/desktop/src/main/machines/rpc.ts',
      'apps/desktop/src/main/machines/identity.ts',
      'apps/desktop/src/main/project-tools/{common,copies,git,git-parse,services,tasks}.ts',
      'apps/desktop/src/main/workspace-files.ts',
      'apps/desktop/src/main/artifact-files.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: '远端辅助进程不得依赖 electron' }],
          patterns: mainLayerImportPatterns,
        },
      ],
    },
  },
  {
    // renderer 不导入 src/main。用 @typescript-eslint/no-restricted-imports（同样的选项）而不是
    // no-restricted-imports：后者同名，下面的 mock 规则（warn）会整体覆盖它。
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/main', '**/main/**'], message: 'renderer 不得导入 src/main；需要的类型放 src/shared' },
          ],
        },
      ],
    },
  },
  {
    // packages/protocol 不依赖 electron（协议是纯类型与纯逻辑，远端与本机共用）
    files: ['packages/protocol/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'electron', message: 'packages/protocol 不得依赖 electron' }] },
      ],
    },
  },
  {
    // 包入口禁止 export *，导出名集合要能被静态看清
    files: ['packages/*/src/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: '包入口 index.ts 不得使用 export *，请显式列出导出名',
        },
      ],
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
