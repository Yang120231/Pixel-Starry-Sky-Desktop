// 把 Material Icon Theme 拷成内置扩展 pixelsky.material-icons（docs/ui/file-tree-icons.md、extension-center.md）。
// 用法：node scripts/vendor-material-icons.mjs <material-icon-theme 解压后的 package 目录>
//   例：node scripts/vendor-material-icons.mjs ../../scratch/2026-10-15-icons/material/package
// 只改文件位置：dist/material-icons.json -> theme/material-icons.json，icons/ 原样；对照表里的 ./../icons/x.svg 正好指到扩展根的 icons/。
// 结果入库在 resources/builtin-extensions/，打包时由 electron-builder.yml 的 extraResources 带走；该目录在 .prettierignore 里，别格式化。
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !existsSync(join(src, 'dist/material-icons.json'))) {
  console.error('用法：node scripts/vendor-material-icons.mjs <material-icon-theme package 目录>')
  process.exit(1)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources/builtin-extensions/pixelsky.material-icons')
const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'theme'), { recursive: true })
cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true })
cpSync(join(src, 'dist/material-icons.json'), join(out, 'theme/material-icons.json'))

const license = readFileSync(join(src, 'LICENSE'), 'utf8').replace(/\s+$/, '')
writeFileSync(
  join(out, 'LICENSE'),
  `${license}\n\nSource: https://github.com/material-extensions/vscode-material-icon-theme (material-icon-theme ${version})\n`,
)

const manifest = {
  id: 'pixelsky.material-icons',
  name: 'Material Icon Theme',
  version,
  publisher: 'pixelsky',
  description: '文件树和标签上的彩色文件图标（Material Icon Theme，MIT）',
  keywords: ['icons', 'file icons', '图标'],
  license: 'MIT',
  repository: 'https://github.com/material-extensions/vscode-material-icon-theme',
  homepage: null,
  engines: { pixelsky: '>=0.4.0' },
  l10n: {
    en: {
      name: 'Material Icon Theme',
      description: 'Colorful file icons for the file tree and tabs (Material Icon Theme, MIT)',
    },
  },
  contributes: { iconThemes: [{ id: 'material', label: 'Material', path: 'theme/material-icons.json' }] },
  main: null,
  permissions: [],
  price: null,
}
writeFileSync(join(out, 'pixelsky-extension.json'), JSON.stringify(manifest, null, 2) + '\n')

writeFileSync(
  join(out, 'README.md'),
  `# Material Icon Theme

像素星空内置的文件图标主题。

- 来源：https://github.com/material-extensions/vscode-material-icon-theme
- 版本：${version}
- 许可证：MIT（见 LICENSE）
- 改动：只改了文件位置——\`dist/material-icons.json\` 放到 \`theme/material-icons.json\`，\`icons/\` 原样拷贝，内容一个字节没改。

重新生成：\`node scripts/vendor-material-icons.mjs <material-icon-theme 的 package 目录>\`（在 apps/desktop 下）。
`,
)
console.log(`material-icons ${version} -> ${out}`)
