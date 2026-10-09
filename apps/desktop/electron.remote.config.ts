import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({ main: { build: {
  outDir: 'out/remote',
  rollupOptions: { input: resolve(__dirname, 'src/main/machines/remote-entry.ts'), output: { format: 'cjs', entryFileNames: 'helper.cjs', inlineDynamicImports: true } },
} } })
