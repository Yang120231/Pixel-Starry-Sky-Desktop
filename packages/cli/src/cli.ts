#!/usr/bin/env node
// 像素星空命令行入口：基于 Pi（MIT），品牌 / 配置目录由依赖包 package.json 的 piConfig 补丁换成
// pixelsky / .pixelsky-cli（补丁见 patches/，说明见 docs/own-cli.md §5.1）。
// 注意：只用可擦除的 TS 语法（Node 直接剥类型运行）。
import { interceptArgv } from './argv.ts'
import { createApprovalExtension } from './extensions/approval.ts'
import { todoExtension } from './tools/todo.ts'

// 关安装统计和版本检查；用户自己设了环境变量就不覆盖。
process.env.PI_TELEMETRY ??= '0'
process.env.PI_SKIP_VERSION_CHECK ??= '1'

const intercepted = interceptArgv(process.argv.slice(2))
if (intercepted.action === 'blocked') {
  console.error(intercepted.message)
  process.exit(intercepted.exitCode)
}

// 必须在设置环境变量之后再加载 Pi
const { main } = await import('@earendil-works/pi-coding-agent')
if (intercepted.action === 'run') {
  await main(intercepted.args, { extensionFactories: [createApprovalExtension(), todoExtension] })
}
