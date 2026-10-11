// 打安卓 APK（docs/mobile-remote.md §15）：构建 App 版网页 → cap sync → gradle assembleRelease。
// JDK 21 和 Android SDK 默认在用户目录（~/.jdks/zulu21、~/Android/Sdk），可用 JAVA_HOME / ANDROID_HOME 覆盖；
// 签名配置默认 ~/.pixelsky/android/keystore.properties（仓库外）。只在这个进程里设环境变量，不改系统设置。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const app = resolve(import.meta.dirname, '..')
const android = join(app, 'android')
const home = homedir()
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || join(home, '.jdks', 'zulu21'),
  ANDROID_HOME: process.env.ANDROID_HOME || join(home, 'Android', 'Sdk'),
  PIXELSKY_KEYSTORE_PROPS:
    process.env.PIXELSKY_KEYSTORE_PROPS || join(home, '.pixelsky', 'android', 'keystore.properties'),
}
for (const [name, path] of [
  ['JAVA_HOME', env.JAVA_HOME],
  ['ANDROID_HOME', env.ANDROID_HOME],
])
  if (!existsSync(path)) throw new Error(`${name} 不存在：${path}`)
// gradle 从 local.properties 读 SDK 路径（被 .gitignore 忽略）
writeFileSync(join(android, 'local.properties'), `sdk.dir=${env.ANDROID_HOME.replaceAll('\\', '/')}\n`)

// 只有 gradlew.bat 要经过 cmd；node 的路径里可能有空格（C:\Program Files），不能走 shell
const run = (cmd, args, cwd, shell = false) => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const node = process.execPath
run(node, [join(app, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'app'], app)
run(node, [join(app, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], app)
const debug = process.argv.includes('--debug')
run(
  join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
  [debug ? 'assembleDebug' : 'assembleRelease', '--console=plain'],
  android,
  process.platform === 'win32',
)

const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version
const built = join(
  android,
  'app',
  'build',
  'outputs',
  'apk',
  debug ? 'debug' : 'release',
  debug ? 'app-debug.apk' : 'app-release.apk',
)
const outDir = join(app, 'release')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `pixelsky-${version}${debug ? '-debug' : ''}.apk`)
copyFileSync(built, out)
console.log('APK：' + out)
