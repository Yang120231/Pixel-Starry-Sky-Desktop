// 内存基准（docs/session-memory.md）：造一份大对话，量打开前后主进程的堆。每期都量，平时不跑：
//   PIXELSKY_MEMORY_BENCH=1 [PIXELSKY_MEMORY_BENCH_MB=200] npx vitest run test/history-memory.test.ts --silent=false
// 加 PIXELSKY_MEMORY_BENCH_IMAGES=1：每轮的大字节换成用户消息带的一张图（量第 2 期截图片数据的效果），默认在长命令输出里
// 想量得准些加 NODE_OPTIONS=--expose-gc（量之前先回收）
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { EngineHost } from '../src/host'
import { makeTmp, removeTmp } from './helpers/tmp'

const bench = !!process.env.PIXELSKY_MEMORY_BENCH
const images = !!process.env.PIXELSKY_MEMORY_BENCH_IMAGES
const MB = 1024 * 1024

function heap(): number {
  ;(globalThis as { gc?: () => void }).gc?.()
  return process.memoryUsage().heapUsed
}

describe.skipIf(!bench)('内存基准', () => {
  const root = bench ? makeTmp('memory-bench') : ''
  afterAll(() => {
    if (root) removeTmp(root)
  })

  it(
    '打开一份大对话前后的堆；没载入时改名、置顶、归档不载入',
    async () => {
      const size = Number(process.env.PIXELSKY_MEMORY_BENCH_MB || 200) * MB
      const project = join(root, 'project')
      mkdirSync(project)
      const dataDir = join(root, 'data')
      let host = new EngineHost({ dataDir, emit: () => {}, adapters: {} })
      const record = host.createSession({ projectId: host.addProject(project).id })
      await host.shutdown()

      // 一轮：用户消息 + 一条长命令输出 + 一句回复，大部分字节在输出里（和本机大对话的构成相近）；
      // 量图片时大字节在用户消息的图里（base64 和长输出差不多大），命令输出只留一行
      const output = '编译输出 line of build log 0123456789\n'.repeat(500)
      const data = Buffer.alloc(15_000, 7).toString('base64')
      const fd = openSync(join(dataDir, 'sessions', record.id, 'items.jsonl'), 'w')
      let written = 0,
        turn = 0
      while (written < size) {
        const items: Item[] = [
          {
            kind: 'user',
            id: `u${turn}`,
            text: `第 ${turn} 轮`,
            createdAt: turn,
            ...(images
              ? {
                  attachments: [
                    {
                      id: `img${turn}`,
                      name: 'shot.png',
                      mediaType: 'image/png' as const,
                      bytes: 15_000,
                      width: 100,
                      height: 100,
                      dataBase64: data,
                    },
                  ],
                }
              : {}),
          },
          {
            kind: 'command',
            id: `c${turn}`,
            command: 'pnpm build',
            description: null,
            output: images ? 'ok' : output,
            exitCode: 0,
            status: 'completed',
          },
          { kind: 'assistant', id: `a${turn}`, text: `做完了第 ${turn} 轮`, status: 'completed' },
        ]
        const chunk = items.map(i => JSON.stringify(i)).join('\n') + '\n'
        written += writeSync(fd, chunk)
        turn++
      }
      closeSync(fd)

      host = new EngineHost({ dataDir, emit: () => {}, adapters: {} })
      const runtimes = (host as unknown as { runtimes: Map<string, unknown> }).runtimes
      const base = heap()
      host.renameSession(record.id, '大对话')
      host.setSessionPinned(record.id, true)
      await host.archiveSession(record.id, true)
      await host.archiveSession(record.id, false)
      expect(runtimes.size).toBe(0)
      const recordOnly = heap()
      const started = Date.now()
      const snapshot = host.open(record.id)
      const ms = Date.now() - started
      const opened = heap()
      console.log(
        `[内存基准] ${images ? '大字节在图片里' : '大字节在命令输出里'}，文件 ${(written / MB).toFixed(0)} MB，${snapshot.items.length} 条；` +
          `只改记录后堆增加 ${((recordOnly - base) / MB).toFixed(1)} MB；` +
          `打开用 ${ms} ms，打开后堆增加 ${((opened - base) / MB).toFixed(0)} MB（共 ${(opened / MB).toFixed(0)} MB）`,
      )
      expect(snapshot.items.length).toBe(turn * 3)
      await host.shutdown()
    },
    10 * 60_000,
  )
})
