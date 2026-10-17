import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 检查进程（src/workers/ext-check.ts）打包后没有 node_modules 可读：把 onig.wasm 的字节内嵌进去。
 * 源码里 extension-cli 的 onig-wasm.ts 在运行时读磁盘；这里换成内嵌版本
 * （做法同 packages/extension-cli/scripts/build.mjs 的 embedWasm）。
 */
function embedOnigWasm(): Plugin {
  const virtual = '\0pixelsky-onig-wasm'
  return {
    name: 'pixelsky-embed-onig-wasm',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!/(^|[\\/])onig-wasm$/.test(source)) return null
      if (!importer?.replaceAll('\\', '/').includes('/src/lib/grammar/')) return null
      return virtual
    },
    load(id) {
      if (id !== virtual) return null
      const file = createRequire(join(__dirname, 'package.json')).resolve('vscode-oniguruma/release/onig.wasm')
      const base64 = readFileSync(file).toString('base64')
      return (
        `const bytes = Uint8Array.from(Buffer.from(${JSON.stringify(base64)}, 'base64'))\n` +
        'export async function onigWasmBytes() { return bytes }\n'
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [embedOnigWasm()],
    build: {
      // ext-check：本机按上传标准检查扩展的子进程（utilityProcess），语法引擎只在这个入口里，主进程不带
      lib: {
        entry: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'ext-check': resolve(__dirname, 'src/workers/ext-check.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
