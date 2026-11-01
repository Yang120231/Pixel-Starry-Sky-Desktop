// 假的 wsl.exe：解析 -d X [--cd Y] --exec cmd args...，在本机跑，HOME 指向 FAKE_WSL_HOME。
// 只为 wsl.test.ts 服务，把 Windows 上的 node / sh 伪装成「Linux 里的」。
const { spawn } = require('node:child_process')
const argv = process.argv.slice(2)
let cd = null
let i = 0
while (i < argv.length && argv[i] !== '--exec') {
  if (argv[i] === '--cd') cd = argv[++i]
  i++
}
let rest = argv.slice(i + 1)
const home = process.env.FAKE_WSL_HOME
const env = { ...process.env, HOME: home, USERPROFILE: home }
while (rest[0] === 'env' || /^[A-Z_]+=/.test(rest[0] ?? '')) {
  if (rest[0] === 'env') rest.shift()
  else (Object.assign(env, { [rest[0].split('=')[0]]: rest[0].slice(rest[0].indexOf('=') + 1) }), rest.shift())
}
const cmd = rest[0] === 'sh' ? (process.env.FAKE_WSL_SH ?? 'sh') : rest[0] === 'node' ? process.execPath : rest[0]
const args = rest.slice(1)
const helper = args[0]?.endsWith('.cjs')
// 一次性命令的输入自己读、再显式转给下一层：直接继承同一个输入管道在 Windows 上偶尔读到空的
// （探测是 sh -s 从输入读脚本，读到空就什么都不输出地退出，测试时好时坏）
const child = spawn(cmd, args, {
  cwd: cd && cd !== '~' ? cd : home,
  env,
  stdio: helper ? 'inherit' : ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
})
if (!helper) {
  child.stdin.on('error', () => {})
  process.stdin.pipe(child.stdin)
}
if (helper) child.on('exit', code => process.exit(code ?? 1))
if (!helper) {
  const out = []
  child.stdout.on('data', d => out.push(d))
  child.on('close', code => {
    let text = Buffer.concat(out).toString('utf8')
    // 探测：把 Windows 的 node 说成 Linux 的，HOME 用正斜杠；安装：返回的路径也用正斜杠
    text = text
      .replace(/"platform":"win32"/g, '"platform":"linux"')
      .replace(/"home":"[^"]*"/, '"home":' + JSON.stringify(home))
    if (!text.includes('PIXELSKY_PROBE=')) text = text.replaceAll('\\', '/')
    process.stdout.write(text, () => process.exit(code ?? 1))
  })
}
