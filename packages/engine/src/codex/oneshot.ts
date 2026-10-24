// Codex 单独问一次（AI 写提交信息的 ChatGPT 授权通道，docs/ui/ai-commit-channels.md §4）：起一个临时 app-server，
// 在临时目录里开线程（只读沙箱、从不审批、尽量不留记录），发一条消息，等这一轮结束，取最后一条回复
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Launcher } from '../adapter'
import {
  ONE_SHOT_TIMEOUT,
  OneShotError,
  oneShotProblem,
  type OneShotProblem,
  type OneShotReply,
  type OneShotRequest,
} from '../oneshot'
import { CodexProcess, object, string, type Message } from './process'
import { tokenCounts } from './translate'

/** Codex 错误里的 codexErrorInfo → 原因；认不出时按原话分类 */
export function codexOneShotProblem(error: unknown): OneShotProblem {
  const e = object(error)
  const info = e.codexErrorInfo
  const kinds = typeof info === 'string' ? [info] : info && typeof info === 'object' ? Object.keys(info) : []
  for (const kind of kinds) {
    if (/usageLimit/i.test(kind)) return 'usageLimit'
    if (/unauthorized/i.test(kind)) return 'notAuthorized'
  }
  if (info && typeof info === 'object')
    for (const value of Object.values(info as Record<string, unknown>))
      if (object(value).httpStatusCode === 401) return 'notAuthorized'
  return oneShotProblem(string(e.message))
}

function removeLater(dir: string): void {
  setTimeout(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch {
      // 临时目录，删不掉也不影响
    }
  }, 500).unref?.()
}

export async function codexOneShot(
  launcher: Launcher,
  launchArgs: string[],
  env: NodeJS.ProcessEnv,
  req: OneShotRequest,
  signal: AbortSignal,
): Promise<OneShotReply> {
  if (signal.aborted) throw new OneShotError('cancelled', '已停止')
  const home = mkdtempSync(join(tmpdir(), 'pixelsky-codex-oneshot-'))
  let text = ''
  let usage: OneShotReply['usage'] = null
  let lastError: unknown = null
  let finish!: (outcome: { ok: true } | { ok: false; error: OneShotError }) => void
  const ended = new Promise<{ ok: true } | { ok: false; error: OneShotError }>(resolve => (finish = resolve))
  const proc: CodexProcess = new CodexProcess(
    launcher,
    ['app-server', '--listen', 'stdio://', ...launchArgs],
    home,
    env,
    {
      notification: (method: string, params: Message) => {
        if (method === 'item/completed') {
          const item = object(params.item)
          if (item.type === 'agentMessage' && string(item.text).trim()) text = string(item.text)
        } else if (method === 'thread/tokenUsage/updated') {
          const last = tokenCounts(object(params.tokenUsage).last)
          usage = { input: last.input, output: last.output, cacheRead: last.cacheRead, cacheWrite: last.cacheWrite }
        } else if (method === 'error' && params.willRetry !== true) lastError = params.error
        else if (method === 'turn/completed') {
          const turn = object(params.turn)
          if (turn.status === 'completed') finish({ ok: true })
          else {
            const error = turn.error ?? lastError
            const message =
              string(object(error).message) || (turn.status === 'interrupted' ? '已停止' : 'Codex 没有写成')
            finish({ ok: false, error: new OneShotError(codexOneShotProblem(error), message) })
          }
        }
      },
      // 只读沙箱、从不审批：不该有请求，来了一律拒绝
      request: id => proc.respondError(id, 'Not available in a one-shot request'),
      exit: (_code, tail) => {
        const message = tail.trim().split(/\r?\n/).at(-1) || 'Codex 意外退出'
        finish({ ok: false, error: new OneShotError(oneShotProblem(message), message) })
      },
    },
  )
  const onAbort = (): void => finish({ ok: false, error: new OneShotError('cancelled', '已停止') })
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(
    () => finish({ ok: false, error: new OneShotError('timeout', 'Codex 太久没有回答') }),
    ONE_SHOT_TIMEOUT,
  )
  try {
    const run = (async () => {
      await proc.initialize(true)
      const params = {
        cwd: home,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ...(req.model ? { model: req.model } : {}),
      }
      // 不留记录（ephemeral）：旧版 Codex 不认这个字段时不带它再开一次
      const thread = await proc.request('thread/start', { ...params, ephemeral: true }).catch((error: Error) => {
        if (/ephemeral|unknown field|invalid params/i.test(error.message)) return proc.request('thread/start', params)
        throw error
      })
      const threadId = string(object(thread.thread).id)
      if (!threadId) throw new Error('Codex 没有开出线程')
      await proc.request('turn/start', { threadId, input: [{ type: 'text', text: req.prompt }] })
      return string(thread.model) || null
    })()
    const stopped = ended.then(outcome => {
      if (!outcome.ok) throw outcome.error
      return null
    })
    // 输掉比赛的那一个之后再失败（进程被结束、请求被拒）不能变成没人接的拒绝
    run.catch(() => undefined)
    stopped.catch(() => undefined)
    // 启动 / 开线程失败也算结束
    const model = await Promise.race([run, stopped]).catch((error: unknown) => {
      if (error instanceof OneShotError) throw error
      const message = (error as Error)?.message ?? String(error)
      throw new OneShotError(oneShotProblem(message), message)
    })
    const outcome = await ended
    if (!outcome.ok) throw outcome.error
    return { text, model, usage }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    proc.kill()
    removeLater(home)
  }
}
