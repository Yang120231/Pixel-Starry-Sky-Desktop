// 终端（TUI）模式的启动参数（docs/ui/tui-toggle.md §5.2）：记录文件已经有了才 --resume，否则 --session-id 开新的。
// 回归：新对话第一次切过去时宿主先把会话 id 写进记录再拼一次，只看 engineSessionId 会用 --resume，Claude Code 报找不到会话直接退出
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionRecord } from '@pixelsky/protocol'
import { ClaudeAdapter } from '../src/claude'
import { encodeCwd } from '../src/claude/transcript'

const FAKE = fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))

let root = ''
let projectsDir = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-tui-launch-'))
  projectsDir = join(root, 'claude-projects')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const record = (engineSessionId?: string): SessionRecord => ({
  id: 'sess-1',
  projectId: 'project',
  cwd: root,
  engine: 'claude',
  engineSessionId: engineSessionId ?? null,
  title: 'test',
  model: null,
  effort: null,
  permissionMode: 'ask',
  ultracode: false,
  fast: false,
  thinkingSummaries: true,
  createdAt: 0,
  updatedAt: 0,
  lastOutcome: null,
})

async function adapter(): Promise<ClaudeAdapter> {
  const a = new ClaudeAdapter({
    launcher: { command: process.execPath, args: [FAKE] },
    projectsDir,
    env: { ...process.env, FAKE_CLAUDE_PROJECTS: projectsDir },
  })
  expect((await a.info()).status).toBe('ready')
  return a
}

describe('ClaudeAdapter.tuiLaunch', () => {
  it('新对话：用对话 id --session-id 开新会话；宿主写进 engineSessionId 后再拼一次，结果不变', async () => {
    const a = await adapter()
    const first = a.tuiLaunch(record())
    expect(first.engineSessionId).toBe('sess-1')
    expect(first.args).toEqual(expect.arrayContaining(['--session-id', 'sess-1']))
    expect(first.args).not.toContain('--resume')
    const again = a.tuiLaunch(record(first.engineSessionId))
    expect(again.args).toEqual(expect.arrayContaining(['--session-id', 'sess-1']))
    expect(again.args).not.toContain('--resume')
  })

  it('记录文件已经有了：--resume 接着原会话', async () => {
    const a = await adapter()
    const sid = '22222222-2222-4222-8222-222222222222'
    mkdirSync(join(projectsDir, encodeCwd(root)), { recursive: true })
    writeFileSync(join(projectsDir, encodeCwd(root), `${sid}.jsonl`), '{}\n')
    const launch = a.tuiLaunch(record(sid))
    expect(launch.args).toEqual(expect.arrayContaining(['--resume', sid]))
    expect(launch.args).not.toContain('--session-id')
  })
})
