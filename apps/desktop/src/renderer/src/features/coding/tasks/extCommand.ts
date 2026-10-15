// 扩展任务模板的命令拼装（docs/extensions/authoring-spec.md §8）：纯函数，不碰 window，也不 import 扩展 store，node 测试可直接用
import type { RunTask, RunTaskGroup } from '../../../../../shared/types/project-tools'

type ShellKind = 'posix' | 'pwsh' | 'cmd'

/** 终端程序的名字：去掉目录和 .exe，小写 */
export function shellName(program: string | undefined): string {
  const base = (program ?? '').replaceAll('\\', '/').split('/').pop() ?? ''
  return base.toLowerCase().replace(/\.exe$/, '')
}

function shellKind(program: string | undefined): ShellKind {
  const name = shellName(program)
  if (name === 'powershell' || name === 'pwsh') return 'pwsh'
  return name === 'cmd' ? 'cmd' : 'posix'
}

const SAFE = /^[\w./:@+=-]+$/
/** 运行器多允许一个反斜杠（.\mvnw.cmd） */
const SAFE_RUNNER = /^[\w./\\:@+=-]+$/

/** 按终端加引号；只有含特殊字符才加 */
function quote(value: string, kind: ShellKind, safe = SAFE): string {
  // cmd 里反斜杠是路径分隔符，不需要引号
  if ((kind === 'cmd' ? SAFE_RUNNER : safe).test(value)) return value
  if (kind === 'cmd') return `"${value.replaceAll('"', '""')}"`
  // PowerShell 把 U+2018–U+201B 也当单引号，都要双写
  if (kind === 'pwsh') return `'${value.replace(/[\u0027\u2018-\u201B]/g, m => m + m)}'`
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** 运行器：项目里的文件加 ./（.\）前缀，PowerShell 里带前缀或引号时前面写 & */
function runnerText(runner: string | null, local: boolean, kind: ShellKind): string {
  if (!runner) return ''
  let text = runner
  let prefixed = false
  const bare = runner.replace(/^\.[/\\]/, '')
  if (local && !/[/\\]/.test(bare)) {
    text = `${kind === 'posix' ? './' : '.\\'}${bare}`
    prefixed = true
  }
  const quoted = quote(text, kind, SAFE_RUNNER)
  return kind === 'pwsh' && (prefixed || quoted !== text) ? `& ${quoted}` : quoted
}

/** 扩展任务在终端里跑的命令；shell 是终端程序，不知道时按 sh 写（PowerShell 也能跑） */
export function extTaskCommand(group: RunTaskGroup, task: RunTask, shell?: string): string {
  const ext = group.ext
  if (!ext) return ''
  const kind = shellKind(shell)
  const q = (value: string): string => quote(value, kind)
  // 一遍替换：替进去的文字不再被扫描
  const fill = (template: string, values: Record<string, string>): string =>
    template.replace(/\{(name|runner|dir|file)\}/g, (_, key: string) => values[key] ?? '')
  const command = fill(ext.command, {
    name: q(task.name),
    runner: runnerText(ext.runner, ext.runnerLocal, kind),
    dir: q(group.dir || '.'),
    file: q(group.file),
  })
  const cwd = fill(ext.cwd, { name: task.name, runner: ext.runner ?? '', dir: group.dir || '.', file: group.file })
  if (cwd === '' || cwd === '.') return command
  const target = q(kind === 'cmd' ? cwd.replaceAll('/', '\\') : cwd)
  if (kind === 'cmd') return `cd /d ${target} && ${command}`
  if (kind === 'pwsh') return `Set-Location -LiteralPath ${target}; if ($?) { ${command} }`
  return `cd ${target} && ${command}`
}
