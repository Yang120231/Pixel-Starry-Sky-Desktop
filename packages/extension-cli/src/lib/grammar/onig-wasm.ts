import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** 源码 / 测试：从 vscode-oniguruma 读 onig.wasm；打包时由 build.mjs 换成内嵌版本 */
export async function onigWasmBytes(): Promise<Uint8Array> {
  const file = createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm')
  return new Uint8Array(readFileSync(file))
}
