// 短命的辅助进程（docs/ui/rewind-fork-sidechat.md §0）：不占用会话进程，做完就退出。
// - 恢复代码：stream-json 模式发 rewind_files 控制请求（可以只预览），不调用模型
// - 旁聊：-p 单次问答，--fork-session --no-session-persistence --tools ""，没有工具、不写会话记录
import { spawn } from 'node:child_process'
import type { Launcher, RewindFilesReply } from '../adapter'
export type { RewindFilesReply }
import { IS_WINDOWS, killTree } from '../exec'
import { ClaudeProcess } from './process'

export interface HelperTarget {
  launcher: Launcher
  cwd: string
  env: NodeJS.ProcessEnv
  /** --resume <会话>，平台会话再加 --settings <网关配置> */
  resumeArgs: string[]
}

const STREAM_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']

/** rewind_files 的回复 → 结果；canRewind 为 false 时多半是这条消息没有检查点 */
export function parseRewindReply(raw: Record<string, unknown>): RewindFilesReply {
  if (raw.canRewind !== true) {
    const message = typeof raw.error === 'string' ? raw.error : ''
    return { ok: false, reason: /checkpoint/i.test(message) || !message ? 'no-checkpoint' : 'failed', message }
  }
  const files = Array.isArray(raw.filesChanged)
    ? raw.filesChanged.filter((f): f is string => typeof f === 'string')
    : []
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { ok: true, files, insertions: num(raw.insertions), deletions: num(raw.deletions) }
}

export async function rewindFilesOnce(
  target: HelperTarget,
  userMessageId: string,
  dryRun: boolean,
): Promise<RewindFilesReply> {
  const proc = new ClaudeProcess(target.launcher, [...STREAM_ARGS, ...target.resumeArgs], target.cwd, target.env, {
    onMessage: () => undefined,
    onControlRequest: () => undefined,
    onControlCancel: () => undefined,
    onExit: () => undefined,
  })
  try {
    await proc.request('initialize', {}, 30_000)
    const raw = await proc.request(
      'rewind_files',
      { user_message_id: userMessageId, ...(dryRun ? { dry_run: true } : {}) },
      60_000,
    )
    return parseRewindReply(raw)
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: proc.alive ? (err as Error).message : proc.stderrTail.trim() || (err as Error).message,
    }
  } finally {
    // 等它退出（Windows 上进程还在时工作目录删不掉）
    await proc.close(3_000)
  }
}

/** 旁聊的启动参数（单测用） */
export function sideQuestionArgs(resumeArgs: string[], model: string | null): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    ...resumeArgs,
    '--fork-session',
    '--no-session-persistence',
    '--tools',
    '',
    ...(model ? ['--model', model] : []),
  ]
}

/** 单次问答：问题从 stdin 进（不受命令行长度和引号影响），stdout 是一个 JSON 结果 */
export function sideQuestionOnce(
  target: HelperTarget,
  prompt: string,
  model: string | null,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('已停止'))
    const child = spawn(
      target.launcher.command,
      [...target.launcher.args, ...sideQuestionArgs(target.resumeArgs, model)],
      {
        cwd: target.cwd,
        env: target.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !IS_WINDOWS,
      },
    )
    let out = '',
      err = ''
    const kill = (): void => {
      killTree(child)
    }
    const onAbort = (): void => {
      kill()
      reject(new Error('已停止'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      kill()
      reject(new Error('旁聊超时（5 分钟）'))
    }, 5 * 60_000)
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString('utf8')).slice(-4000)))
    child.stdin.on('error', () => undefined)
    child.on('error', e => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return
      try {
        resolve(parseSideAnswer(out))
      } catch (e) {
        reject(new Error(lastLine(err) || (e as Error).message))
      }
    })
    child.stdin.end(prompt)
  })
}

/** -p --output-format json 的结果；is_error 时把 result 当错误原因 */
export function parseSideAnswer(stdout: string): string {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find(l => l.trim().startsWith('{'))
  if (!line) throw new Error('Claude Code 没有回答')
  const j = JSON.parse(line) as { result?: unknown; is_error?: unknown }
  const text = typeof j.result === 'string' ? j.result : ''
  if (j.is_error === true) throw new Error(text || 'Claude Code 回答失败')
  return text
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1) ?? ''
}
