import { createRequire } from 'node:module'

declare const __EXT_CLI_VERSION__: string | undefined
declare const __APP_VERSION__: string | undefined

/** 源码运行（测试、pnpm ext 之外的直跑）时读 package.json 的 version */
function readVersion(rel: string): string {
  try {
    const v = (createRequire(import.meta.url)(rel) as { version?: unknown }).version
    return typeof v === 'string' ? v : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// 打包时由 esbuild define 注入；源码运行时改读 package.json
export const TOOL_VERSION: string =
  typeof __EXT_CLI_VERSION__ === 'string' ? __EXT_CLI_VERSION__ : readVersion('../../package.json')
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : readVersion('../../../../apps/desktop/package.json')
