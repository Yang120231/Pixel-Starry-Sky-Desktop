// 内存遥测的计数（docs/ui/renderer-memory.md §3.2.3）
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeAdapter, EngineHost } from '../src'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
beforeEach(() => {
  root = makeTmp('memory-stats')
})
afterEach(() => removeTmp(root))

describe('memoryStats', () => {
  it('没有会话时全是 0；打开的会话各算一个运行时，没有进程、没有在跑', async () => {
    const host = new EngineHost({
      dataDir: join(root, 'data'),
      adapters: { claude: new ClaudeAdapter({ projectsDir: join(root, 'projects') }) },
      emit: () => {},
    })
    try {
      expect(host.memoryStats()).toEqual({ runtimes: 0, processes: 0, running: 0 })
      const project = host.addProject(root)
      const record = host.createSession({ projectId: project.id, engine: 'claude' })
      host.open(record.id)
      expect(host.memoryStats()).toEqual({ runtimes: 1, processes: 0, running: 0 })
    } finally {
      await host.shutdown()
    }
  })
})
