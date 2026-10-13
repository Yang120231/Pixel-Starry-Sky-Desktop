// 代码模式的演示数据（docs/ui/coding-mode-impl.md W1-B 第 7 步）：一个运行中的会话，AI 这一轮改了三个文件。
// 文件内容（before / after）同时给 mock/files.ts（编辑器里看到的是 after）和 mock/git.ts（HEAD 是 before）用，
// 会话里每个 file_change 的 diff 由 before / after 算出来，所以三边对得上。
// 只 import mock/conversations.ts 已导出的工具函数；会话 id 和 features/coding/types.ts 的 CODING_DEMO_SESSION_ID 是同一个字面量。
import type { FileChange, Item, SessionSnapshot } from '@pixelsky/protocol'
import type { Session } from '@/data/types'
import { MIN, T0, assistant, opus, sessionRecord, snapshot, stats, user } from './conversations'

const SESSION_ID = 'demo-coding-v3'
const TURN_ID = 'demo-coding-v3-turn'
const SESSION_TITLE = '顶栏的本机下拉换成本机 / 云端切换'
export const CODING_PROJECT = 'pixel-web'

// ---------------------------------------------------------------------------
// 文件内容
// ---------------------------------------------------------------------------
const HEADER_BEFORE = [
  "import { useSession } from '@/features/engine'",
  "import { Pin } from 'lucide-react'",
  '',
  'export function SessionHeader({ id }: { id: string }) {',
  '  const session = useSession(id)',
  "  const title = session?.record.title ?? ''",
  "  const machine = '本机'",
  '',
  '  return (',
  '    <header className="flex h-10 items-center gap-2 px-3">',
  '      <h1 className="truncate text-sm">{title}</h1>',
  '      <span className="text-xs text-fg-muted">{machine}</span>',
  '      <Pin size={14} />',
  '    </header>',
  '  )',
  '}',
  '',
  'function useCwd(id: string): string {',
  '  const session = useSession(id)',
  "  return session?.record.cwd ?? ''",
  '}',
  '',
  'export function SessionSubtitle({ id }: { id: string }) {',
  '  const cwd = useCwd(id)',
  '',
  '  return <p className="truncate text-xs text-fg-muted">{cwd}</p>',
  '}',
  '',
].join('\n')

const HEADER_AFTER = [
  "import { useSession } from '@/features/engine'",
  "import { MachineSwitch } from '@/machines/MachineSwitch'",
  "import { Pin } from 'lucide-react'",
  '',
  'export function SessionHeader({ id }: { id: string }) {',
  '  const session = useSession(id)',
  "  const title = session?.record.title ?? ''",
  '',
  '  return (',
  '    <header className="flex h-10 items-center gap-2 px-3">',
  '      <h1 className="truncate text-sm">{title}</h1>',
  '      <MachineSwitch />',
  '      <Pin size={14} />',
  '    </header>',
  '  )',
  '}',
  '',
  'function useCwd(id: string): string {',
  '  const session = useSession(id)',
  "  return session?.record.cwd ?? ''",
  '}',
  '',
  'export function SessionSubtitle({ id }: { id: string }) {',
  '  const cwd = useCwd(id)',
  '  const branch = useSession(id)?.record.projectId',
  '',
  '  return (',
  '    <p className="truncate text-xs text-fg-muted">',
  '      {cwd}',
  "      {branch ? ` · ${branch}` : ''}",
  '    </p>',
  '  )',
  '}',
  '',
].join('\n')

const MACHINE_SWITCH = [
  "import { useMachines, setCurrentMachine } from '@/machines/store'",
  '',
  'export function MachineSwitch() {',
  '  const { currentId, machines } = useMachines()',
  '',
  '  return (',
  '    <div role="group" className="flex rounded-md border border-line-layout text-xs">',
  '      {machines.map(m => (',
  '        <button',
  '          key={m.id}',
  '          aria-pressed={m.id === currentId}',
  '          onClick={() => setCurrentMachine(m.id)}',
  '        >',
  '          {m.name}',
  '        </button>',
  '      ))}',
  '    </div>',
  '  )',
  '}',
  '',
].join('\n')

const STORE_BEFORE = [
  "export type MachineId = 'local' | string",
  '',
  'export interface Machine {',
  '  id: MachineId',
  '  name: string',
  '}',
  '',
  "let current: MachineId = 'local'",
  'const listeners = new Set<() => void>()',
  '',
  'export function getCurrentMachine(): MachineId {',
  '  return current',
  '}',
  '',
  'export function subscribeMachines(cb: () => void): () => void {',
  '  listeners.add(cb)',
  '  return () => listeners.delete(cb)',
  '}',
  '',
].join('\n')

const STORE_AFTER = [
  "export type MachineId = 'local' | string",
  '',
  'export interface Machine {',
  '  id: MachineId',
  '  name: string',
  '}',
  '',
  "let current: MachineId = 'local'",
  'const listeners = new Set<() => void>()',
  '',
  'export function getCurrentMachine(): MachineId {',
  '  return current',
  '}',
  '',
  'export function setCurrentMachine(id: MachineId): void {',
  '  if (id === current) return',
  '  current = id',
  '  listeners.forEach(l => l())',
  '}',
  '',
  'export function subscribeMachines(cb: () => void): () => void {',
  '  listeners.add(cb)',
  '  return () => listeners.delete(cb)',
  '}',
  '',
].join('\n')

/** 相对路径 → 改动前后的内容（新建的文件 before 为空） */
export const CODING_FILES: Record<string, { before: string; after: string }> = {
  'src/session/SessionHeader.tsx': { before: HEADER_BEFORE, after: HEADER_AFTER },
  'src/machines/MachineSwitch.tsx': { before: '', after: MACHINE_SWITCH },
  'src/machines/store.ts': { before: STORE_BEFORE, after: STORE_AFTER },
}

// ---------------------------------------------------------------------------
// diff：行级 LCS，输出 unified diff 的正文（@@ 行和 + - 空格开头的行，没有文件头）
// ---------------------------------------------------------------------------
const toLines = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'))

type Op = { t: ' ' | '+' | '-'; text: string }

function editScript(a: string[], b: string[]): Op[] {
  const n = a.length,
    m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const ops: Op[] = []
  let i = 0,
    j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', text: a[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ t: '-', text: a[i++] })
    else ops.push({ t: '+', text: b[j++] })
  }
  while (i < n) ops.push({ t: '-', text: a[i++] })
  while (j < m) ops.push({ t: '+', text: b[j++] })
  return ops
}

/** 前后各留 3 行上下文，改动之间隔得近的并成一块 */
export function unifiedDiff(before: string, after: string, context = 3): string[] {
  const ops = editScript(toLines(before), toLines(after))
  const changed = ops.map((op, i) => (op.t === ' ' ? -1 : i)).filter(i => i >= 0)
  if (!changed.length) return []
  // 把相邻改动（间隔不超过 2 * context 行）分到一组
  const groups: Array<[number, number]> = []
  for (const i of changed) {
    const last = groups[groups.length - 1]
    if (last && i - last[1] <= context * 2 + 1) last[1] = i
    else groups.push([i, i])
  }
  const lines: string[] = []
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context),
      to = Math.min(ops.length - 1, last + context)
    const slice = ops.slice(from, to + 1)
    const before0 = ops.slice(0, from).filter(o => o.t !== '+').length,
      after0 = ops.slice(0, from).filter(o => o.t !== '-').length
    const oldCount = slice.filter(o => o.t !== '+').length,
      newCount = slice.filter(o => o.t !== '-').length
    const start = (base: number, count: number): number => (count === 0 ? base : base + 1)
    lines.push(`@@ -${start(before0, oldCount)},${oldCount} +${start(after0, newCount)},${newCount} @@`)
    for (const op of slice) lines.push(op.t + op.text)
  }
  return lines
}

function fileChange(path: string, kind: FileChange['kind']): FileChange {
  const { before, after } = CODING_FILES[path]
  const lines = unifiedDiff(before, after)
  return {
    path,
    kind,
    diff: lines.join('\n'),
    added: lines.filter(l => l.startsWith('+')).length,
    removed: lines.filter(l => l.startsWith('-')).length,
  }
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
const items: Item[] = [
  // 更早的一轮已经结束：留一张改动卡片，代码模式右侧栏的「审查 / 全部保留」才看得到
  user('coding-u0', '先把 machines/store.ts 里的机器列表订阅整理一下', 14),
  assistant('coding-a0', '订阅和取消订阅整理好了。'),
  {
    kind: 'file_change',
    id: 'coding-e0',
    changes: [fileChange('src/machines/store.ts', 'update')],
    status: 'completed',
  },
  stats('coding-s0', 'completed', { durationMs: 19_000, models: { 'claude-opus-5-5': opus(3_100, 540, 0.0421, 1) } }),
  user('coding-u1', '顶栏的本机下拉换成本机 / 云端切换，切换逻辑放进 machines/store.ts', 6),
  {
    kind: 'tool',
    id: 'coding-t1',
    tool: 'read',
    name: 'Read',
    title: 'src/session/SessionHeader.tsx',
    output: '',
    status: 'completed',
  },
  assistant('coding-a1', '先新建一个切换组件，再改顶栏和 store。'),
  {
    kind: 'file_change',
    id: 'coding-e1',
    changes: [fileChange('src/machines/MachineSwitch.tsx', 'add')],
    status: 'completed',
  },
  {
    kind: 'file_change',
    id: 'coding-e2',
    changes: [fileChange('src/session/SessionHeader.tsx', 'update')],
    status: 'completed',
  },
  {
    kind: 'file_change',
    id: 'coding-e3',
    changes: [fileChange('src/machines/store.ts', 'update')],
    status: 'completed',
  },
  {
    kind: 'command',
    id: 'coding-c1',
    command: 'git status',
    description: '看看改了哪些文件',
    output: [
      'On branch feat/settings-form',
      'Changes not staged for commit:',
      '\tmodified:   src/machines/store.ts',
      '\tmodified:   src/session/SessionHeader.tsx',
      '',
      'Untracked files:',
      '\tsrc/machines/MachineSwitch.tsx',
    ].join('\n'),
    exitCode: 0,
    status: 'completed',
  },
  {
    kind: 'command',
    id: 'coding-c2',
    command: 'npm run typecheck',
    description: '跑类型检查',
    output: '> pixel-web@0.1.0 typecheck\n> tsc --noEmit\n',
    exitCode: null,
    status: 'running',
  },
]

const record = sessionRecord(SESSION_ID, SESSION_TITLE, CODING_PROJECT, {
  lastOutcome: 'completed',
  updatedAt: T0 - MIN,
})

/** 合并进 mock/index.ts 的 conversations.snapshots */
export const codingSnapshots: Record<string, SessionSnapshot> = {
  [SESSION_ID]: snapshot(record, items, {
    state: 'running',
    turnId: TURN_ID,
    execution: { model: 'claude-opus-5-5', effort: 'high', platform: null },
  }),
}

/** 侧栏条目（mock/demo.ts 放进 pixel-web 的第一位） */
export const CODING_SESSION: Session = { id: SESSION_ID, title: SESSION_TITLE, status: 'running' }
