// 产出检查（docs/ui/channels-collab-v2.md §8）：活做完后跑项目的检查命令和几条文本检查

/** 项目的检查设置；没设过时 commands 为 null（自动识别），文本检查开，频道卡片完成后跑 */
export interface CheckConfig {
  /** 要跑的命令；null 是按项目文件自动识别 */
  commands: string[] | null
  /** 只看这次改动的文件：新增的 TODO / FIXME、占位符、Markdown 里打不开的相对链接 */
  text: boolean
  /** 频道任务卡做完后自动跑 */
  channel: boolean
}

export const DEFAULT_CHECK_CONFIG: CheckConfig = { commands: null, text: true, channel: true }
/** 命令最多几条、每条最长 */
export const CHECK_COMMANDS_MAX = 6
export const CHECK_COMMAND_CHARS = 300
/** 一次检查所有命令加起来最长跑这么久 */
export const CHECK_TIMEOUT_MS = 10 * 60_000

/** 识别出来的一条命令：名字（脚本名 / make 目标）和完整命令 */
export interface CheckCommand {
  label: string
  command: string
}

/** 项目的检查计划：设置、自动识别到的命令、实际要跑的命令 */
export interface CheckPlan {
  config: CheckConfig
  detected: CheckCommand[]
  commands: CheckCommand[]
}

export interface CheckCommandResult {
  kind: 'command'
  label: string
  command: string
  status: 'pass' | 'fail' | 'timeout' | 'error'
  exitCode: number | null
  ms: number
  /** 输出的最后一段（已脱敏） */
  output: string
}

export interface CheckFinding {
  rule: 'todo' | 'placeholder' | 'link'
  /** 相对项目目录（posix） */
  file: string
  line: number
  text: string
}

export interface CheckTextResult {
  kind: 'text'
  status: 'pass' | 'warn' | 'skipped'
  findings: CheckFinding[]
  /** 跳过的原因（不是 Git 仓库等） */
  note?: string
}

export type CheckItem = CheckCommandResult | CheckTextResult

/** 一次检查；running 时 items 是已经跑完的 */
export interface CheckRun {
  id: string
  at: number
  status: 'running' | 'done'
  items: CheckItem[]
  endedAt?: number | null
}

/** 一次检查有没有要处理的：命令失败 / 超时，或文本检查有发现 */
export function checkProblems(run: CheckRun): { failed: CheckCommandResult[]; findings: CheckFinding[] } {
  const failed = run.items.filter((i): i is CheckCommandResult => i.kind === 'command' && i.status !== 'pass')
  const findings = run.items.flatMap(i => (i.kind === 'text' ? i.findings : []))
  return { failed, findings }
}

const RULE: Record<CheckFinding['rule'], string> = {
  todo: '新增的 TODO / FIXME',
  placeholder: '没填的占位符',
  link: '打不开的相对链接',
}

/** 「让它修」发回去的内容：失败的命令和输出、文本检查的发现 */
export function fixRequest(run: CheckRun): string {
  const { failed, findings } = checkProblems(run)
  const parts = ['做完后自动跑的检查没通过，请修好（修完不用再自己跑一遍，会自动再检查）：']
  for (const f of failed)
    parts.push(
      `「${f.command}」${f.status === 'timeout' ? '超时' : f.status === 'error' ? '没能运行' : `失败（退出码 ${f.exitCode ?? '?'}）`}，输出的最后一段：\n\`\`\`\n${f.output.slice(-3000)}\n\`\`\``,
    )
  if (findings.length)
    parts.push(
      '文本检查发现：\n' +
        findings
          .slice(0, 30)
          .map(x => `- ${x.file}:${x.line} ${RULE[x.rule]}：${x.text}`)
          .join('\n'),
    )
  return parts.join('\n\n')
}
