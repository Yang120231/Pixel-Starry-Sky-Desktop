import type { Lang } from './i18n'

const ZH = {
  main: `pixelsky-ext：检查和打包像素星空扩展

用法：
  pixelsky-ext validate [路径]      路径是扩展文件夹或 .zip，默认当前目录
  pixelsky-ext pack [文件夹]        先按上传标准检查，通过了打成 <id>-<version>.zip
  pixelsky-ext help [命令]          也可以写 --help / -h
  pixelsky-ext --version

通用参数：
  --grammar full|regex|off   full 编译正则并测速度（上传默认）；regex 只编译；off 都不查
  --strict                   提示（hint）也算不通过
  --json                     只往标准输出写一个 JSON
  --lang zh|en               输出语言（默认看 PIXELSKY_LANG、LANG、系统区域）
  --no-color                 不上色（也认 NO_COLOR、FORCE_COLOR）

退出码：0 通过，1 不通过，2 用法错误，3 工具出错
更多：docs/extensions/cli.md
`,
  validate: `pixelsky-ext validate [路径] [参数]

检查一个扩展文件夹或 .zip，列出问题，告诉你上传时会不会被拒绝。

参数：
  --level upload|dev         upload（默认）：上传标准；dev：和软件「从文件夹加载」逐条相同，不跑语法引擎，不能检查 zip
  --grammar full|regex|off   只在 upload 档有用，默认 full（dev 档只能是 off）
  --app-version <x.y.z>      只在 dev 档有用：判断 engines.pixelsky 满不满足（默认构建时软件的版本）
  --strict                   upload：提示也算不通过；dev：警告也算不通过
  --json                     只往标准输出写一个 JSON
  --lang zh|en               输出语言
  --no-color                 不上色

退出码：0 通过，1 不通过，2 用法错误，3 工具出错
`,
  pack: `pixelsky-ext pack [文件夹] [参数]

按上传标准检查，通过了才打成 zip（默认 <当前目录>/<id>-<version>.zip）。
同样的文件每次打出来逐字节相同。不通过就不写任何文件。

参数：
  -o, --out <文件.zip|已有文件夹>   输出位置；同名文件会被覆盖；不能指到扩展里的子文件夹
  --dry-run                        只检查，列出会打进去的文件，不写 zip
  --grammar full|regex|off         默认 full
  --strict                         提示也算不通过
  --json                           只往标准输出写一个 JSON
  --lang zh|en                     输出语言
  --no-color                       不上色

退出码：0 通过并已写出，1 不通过，2 用法错误，3 工具出错
`,
}

const EN = {
  main: `pixelsky-ext: check and pack PixelSky extensions

Usage:
  pixelsky-ext validate [path]      path is an extension folder or a .zip; defaults to the current directory
  pixelsky-ext pack [folder]        check at upload level, then pack into <id>-<version>.zip
  pixelsky-ext help [command]       also --help / -h
  pixelsky-ext --version

Common options:
  --grammar full|regex|off   full compiles regexes and measures speed (upload default); regex compiles only; off skips both
  --strict                   hints also count as failures
  --json                     write a single JSON document to stdout
  --lang zh|en               output language (default: PIXELSKY_LANG, LANG, system locale)
  --no-color                 no colors (NO_COLOR and FORCE_COLOR are honored)

Exit codes: 0 pass, 1 fail, 2 usage error, 3 tool error
More: docs/extensions/cli.md
`,
  validate: `pixelsky-ext validate [path] [options]

Check an extension folder or .zip and list the problems, including whether an upload would be rejected.

Options:
  --level upload|dev         upload (default): upload standard; dev: identical to the app's "load from folder", no grammar engine, zip not allowed
  --grammar full|regex|off   upload only, default full (dev only allows off)
  --app-version <x.y.z>      dev only: evaluates engines.pixelsky (default: the app version at build time)
  --strict                   upload: hints fail too; dev: warnings fail too
  --json                     write a single JSON document to stdout
  --lang zh|en               output language
  --no-color                 no colors

Exit codes: 0 pass, 1 fail, 2 usage error, 3 tool error
`,
  pack: `pixelsky-ext pack [folder] [options]

Check at upload level and pack into a zip only if it passes (default <cwd>/<id>-<version>.zip).
The same files always produce a byte-identical zip. Nothing is written when the check fails.

Options:
  -o, --out <file.zip|existing folder>   output location; an existing file is overwritten; must not point into a subfolder of the extension
  --dry-run                              check only, list the files that would be packed, write no zip
  --grammar full|regex|off               default full
  --strict                               hints fail too
  --json                                 write a single JSON document to stdout
  --lang zh|en                           output language
  --no-color                             no colors

Exit codes: 0 pass and written, 1 fail, 2 usage error, 3 tool error
`,
}

export function helpText(lang: Lang, command?: string): string {
  const d = lang === 'zh' ? ZH : EN
  if (command === 'validate') return d.validate
  if (command === 'pack') return d.pack
  return d.main
}
