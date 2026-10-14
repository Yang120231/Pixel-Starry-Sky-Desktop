// 处理器抛错时：记日志、接着处理同一块里后面的消息，不能变成主进程未捕获异常（审查报告 2026-10-14）
import { describe, expect, it } from 'vitest'
import { ClaudeProcess } from '../src/claude/process'
import { CodexProcess } from '../src/codex/process'
import { PixelProcess } from '../src/pixel/process'

/** 一次写出三行（同一块），然后等 stdin 关掉再退出 */
const script = (lines: unknown[]): string[] => [
  '-e',
  `process.stdout.write(${JSON.stringify(lines.map(l => JSON.stringify(l)).join('\n') + '\n')}); process.stdin.on('end', () => process.exit(0)); process.stdin.resume()`,
]
const launcher = (lines: unknown[]) => ({ command: process.execPath, args: script(lines) })

/** 跑到收齐 want 条或者超时；期间有未捕获异常就记下 */
async function collect(start: (seen: string[], done: () => void) => { kill(): void }, want: number) {
  const seen: string[] = []
  const uncaught: unknown[] = []
  const onUncaught = (e: unknown) => uncaught.push(e)
  process.on('uncaughtException', onUncaught)
  let finish!: () => void
  const finished = new Promise<void>(r => (finish = r))
  const proc = start(seen, () => seen.length >= want && finish())
  await Promise.race([finished, new Promise(r => setTimeout(r, 2500))])
  proc.kill()
  process.off('uncaughtException', onUncaught)
  return { seen, uncaught }
}

describe('子进程输出的处理器抛错', () => {
  it('Claude：中间一条抛错，后面一条照常处理', async () => {
    const { seen, uncaught } = await collect(
      (seen, check) =>
        new ClaudeProcess(launcher([{ type: 'a' }, { type: 'boom' }, { type: 'c' }]), [], process.cwd(), process.env, {
          onMessage: m => {
            seen.push(String(m.type))
            check()
            if (m.type === 'boom') throw new Error('处理器出错')
          },
          onControlRequest: () => {},
          onControlCancel: () => {},
          onExit: () => {},
        }),
      3,
    )
    expect(seen).toEqual(['a', 'boom', 'c'])
    expect(uncaught).toEqual([])
  })
  it('Codex：中间一条抛错，后面一条照常处理', async () => {
    const lines = ['a', 'boom', 'c'].map(method => ({ method, params: {} }))
    const { seen, uncaught } = await collect(
      (seen, check) =>
        new CodexProcess(launcher(lines), [], process.cwd(), process.env, {
          notification: method => {
            seen.push(method)
            check()
            if (method === 'boom') throw new Error('处理器出错')
          },
          request: () => {},
          exit: () => {},
        }),
      3,
    )
    expect(seen).toEqual(['a', 'boom', 'c'])
    expect(uncaught).toEqual([])
  })
  it('Pixel：中间一条抛错，后面一条照常处理', async () => {
    const lines = ['a', 'boom', 'c'].map(type => ({ type }))
    const { seen, uncaught } = await collect(
      (seen, check) =>
        new PixelProcess(launcher(lines), [], process.cwd(), process.env, {
          event: e => {
            seen.push(String(e.type))
            check()
            if (e.type === 'boom') throw new Error('处理器出错')
          },
          exit: () => {},
        }),
      3,
    )
    expect(seen).toEqual(['a', 'boom', 'c'])
    expect(uncaught).toEqual([])
  })
})
