// 代码模式演示数据：会话里的改动、编辑器里的文件、git 对比三边要对得上
import { describe, expect, it } from 'vitest'
import { demo } from './demo'
import { DEMO_FILES } from './files'
import { demoGitDiff, demoGitStatus } from './git'
import { CODING_FILES, CODING_SESSION, codingSnapshots, unifiedDiff } from './coding'
import { demoToolEnvironment } from './projectTools'

const snapshot = codingSnapshots['demo-coding-v3']
const lastUser = snapshot.items.map(i => i.kind).lastIndexOf('user')
// 当前这一轮（还没结束）的改动；更早一轮的另算
const changes = snapshot.items.slice(lastUser).flatMap(i => (i.kind === 'file_change' ? i.changes : []))
const earlier = snapshot.items.slice(0, lastUser).flatMap(i => (i.kind === 'file_change' ? i.changes : []))

/** 把 diff 正文套到 before 上，得到 after（独立于生成它的 LCS 代码） */
function apply(before: string, diff: string[]): string {
  const old = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const out: string[] = []
  let at = 0
  for (const line of diff) {
    const head = /^@@ -(\d+),(\d+) \+\d+,\d+ @@$/.exec(line)
    if (head) {
      const start = Number(head[2]) === 0 ? Number(head[1]) : Number(head[1]) - 1
      while (at < start) out.push(old[at++])
    } else if (line[0] === '+') out.push(line.slice(1))
    else if (line[0] === '-') at++
    else {
      out.push(old[at++])
    }
  }
  while (at < old.length) out.push(old[at++])
  return out.length ? out.join('\n') + '\n' : ''
}

describe('代码模式演示数据', () => {
  it('会话 id 和项目', () => {
    expect(snapshot.record.id).toBe('demo-coding-v3')
    expect(snapshot.record.projectId).toBe('pixel-web')
    expect(snapshot.record.engine).toBe('claude')
    expect(snapshot.state).toBe('running')
    expect(snapshot.turnId).not.toBeNull()
  })

  it('更早一轮已结束并带一张改动卡片', () => {
    expect(earlier.length).toBeGreaterThan(0)
    for (const c of earlier) expect(CODING_FILES[c.path], c.path).toBeDefined()
    expect(snapshot.items.slice(0, lastUser).some(i => i.kind === 'turn_stats')).toBe(true)
  })

  it('每个 file_change 的路径都在 DEMO_FILES 里，内容是改完以后的', () => {
    expect(changes.length).toBe(3)
    for (const c of changes) expect(DEMO_FILES[c.path], c.path).toBe(CODING_FILES[c.path].after)
  })

  it('diff 的增删行数对得上，套回 before 得到 after', () => {
    for (const c of changes) {
      const { before, after } = CODING_FILES[c.path]
      const lines = c.diff.split('\n')
      expect(lines.filter(l => l.startsWith('+')).length, c.path).toBe(c.added)
      expect(lines.filter(l => l.startsWith('-')).length, c.path).toBe(c.removed)
      for (const l of lines) expect(/^(@@|\+|-| )/.test(l), l).toBe(true)
      expect(apply(before, unifiedDiff(before, after)), c.path).toBe(after)
    }
  })

  it('SessionHeader.tsx 至少有两处分开的改动，after 里有 function SessionHeader', () => {
    const header = changes.find(c => c.path === 'src/session/SessionHeader.tsx')!
    expect(header.diff.split('\n').filter(l => l.startsWith('@@')).length).toBeGreaterThanOrEqual(2)
    expect(CODING_FILES['src/session/SessionHeader.tsx'].after).toContain('function SessionHeader')
  })

  it('新建的文件 before 为空，kind 为 add', () => {
    const add = changes.find(c => c.path === 'src/machines/MachineSwitch.tsx')!
    expect(add.kind).toBe('add')
    expect(CODING_FILES[add.path].before).toBe('')
    expect(add.removed).toBe(0)
  })

  it('git 状态和对比用同一份内容', () => {
    const listed = [...demoGitStatus.unstaged, ...demoGitStatus.untracked].map(f => f.path)
    for (const [path, { before, after }] of Object.entries(CODING_FILES)) {
      expect(listed, path).toContain(path)
      expect(demoGitDiff(path)).toMatchObject({ original: before, modified: after })
    }
  })

  it('侧栏 pixel-web 第一位是这个会话，服务里有 5173 的 dev 服务', () => {
    expect(demo.projects.find(p => p.id === 'pixel-web')!.sessions[0]).toEqual(CODING_SESSION)
    const dev = demoToolEnvironment.services.find(s => s.port === 5173)!
    expect(dev).toMatchObject({ status: 'running', command: 'npm run dev' })
    expect(dev.output).toContain('http://localhost:5173/')
  })
})
