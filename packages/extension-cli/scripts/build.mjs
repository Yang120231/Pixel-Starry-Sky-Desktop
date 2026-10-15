// esbuild 打包成单文件 dist/pixelsky-ext.mjs（plan §4.7）：onig.wasm 内嵌，Node >= 20 直接跑
// 导出 build()，也能当命令行用：node scripts/build.mjs [--outfile <p>] [--quiet]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 读 JSON 里的 version */
function versionOf(file) {
  return JSON.parse(readFileSync(file, 'utf8')).version
}

/** LICENSES/* 拼成一份第三方声明 */
function thirdPartyNotices() {
  const dir = join(root, 'LICENSES')
  const parts = readdirSync(dir)
    .filter(n => !n.startsWith('.'))
    .sort()
    .map(n => `==== ${n} ====\n\n${readFileSync(join(dir, n), 'utf8').trim()}\n`)
  return `pixelsky-ext 第三方组件声明 / Third-party notices\n\n${parts.join('\n')}`
}

/**
 * @param {{ outfile?: string, quiet?: boolean, entry?: string }} [opts] entry 只给测试用（换一个入口，同样的插件和 define）
 * @returns {Promise<{ outfile: string }>}
 */
export async function build(opts = {}) {
  const outfile = resolve(opts.outfile ?? join(root, 'dist', 'pixelsky-ext.mjs'))
  const entry = resolve(opts.entry ?? join(root, 'src', 'main.ts'))
  const onigWasm = createRequire(join(root, 'package.json')).resolve('vscode-oniguruma/release/onig.wasm')
  // 源码里的 onig-wasm.ts 在运行时读磁盘；打包时换成内嵌字节
  const embedWasm = {
    name: 'embed-onig-wasm',
    setup(b) {
      b.onResolve({ filter: /(^|[\\/])onig-wasm$/ }, args => {
        if (args.importer.replaceAll('\\', '/').includes('/src/lib/grammar/'))
          return { path: 'onig-wasm', namespace: 'embedded-onig' }
        return null
      })
      b.onLoad({ filter: /.*/, namespace: 'embedded-onig' }, () => ({
        contents:
          `import bytes from ${JSON.stringify(onigWasm)}\n` +
          'export async function onigWasmBytes() { return bytes }\n',
        loader: 'js',
        resolveDir: root,
      }))
    },
  }
  mkdirSync(dirname(outfile), { recursive: true })
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: opts.quiet ? 'silent' : 'info',
    legalComments: 'none',
    loader: { '.wasm': 'binary' },
    plugins: [embedWasm],
    banner: {
      js:
        '#!/usr/bin/env node\n' +
        "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    define: {
      __EXT_CLI_VERSION__: JSON.stringify(versionOf(join(root, 'package.json'))),
      __APP_VERSION__: JSON.stringify(versionOf(join(root, '..', '..', 'apps', 'desktop', 'package.json'))),
    },
  })
  writeFileSync(join(dirname(outfile), 'THIRD-PARTY-NOTICES.txt'), thirdPartyNotices())
  return { outfile }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--outfile')
  const { outfile } = await build({ outfile: at >= 0 ? args[at + 1] : undefined, quiet: args.includes('--quiet') })
  if (!args.includes('--quiet')) console.log(`built ${outfile}`)
}
