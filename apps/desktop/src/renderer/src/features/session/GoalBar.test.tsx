// Codex 目标模式的目标栏（docs/ui/codex-goal.md §2）
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionGoal } from '@pixelsky/protocol'
vi.hoisted(() => {
  ;(globalThis as { window?: unknown }).window ??= {}
})
const goals: Record<string, SessionGoal | null> = {}
vi.mock('@/features/engine/store', () => ({
  useEngineState: <T,>(selector: (s: { snapshots: Record<string, { goal: SessionGoal | null }> }) => T): T =>
    selector({ snapshots: Object.fromEntries(Object.entries(goals).map(([id, goal]) => [id, { goal }])) }),
}))
import { I18nProvider } from '@/i18n/I18nProvider'
import { GoalBar, goalResultText, goalUsageText } from './GoalBar'

const goal = (patch: Partial<SessionGoal> = {}): SessionGoal => ({
  objective: '把测试修好',
  status: 'active',
  tokensUsed: 12_345,
  tokenBudget: null,
  timeUsedSeconds: 95,
  updatedAt: 0,
  ...patch,
})
const render = (id: string | null) =>
  renderToStaticMarkup(
    <I18nProvider>
      <GoalBar sessionId={id} onAction={async () => null} />
    </I18nProvider>,
  )

describe('GoalBar', () => {
  it('没有目标时不显示', () => {
    goals.none = null
    expect(render('none')).toBe('')
    expect(render(null)).toBe('')
  })

  it('进行中：目标、状态、用量，能暂停和清除', () => {
    goals.s = goal()
    const html = render('s')
    expect(html).toContain('把测试修好')
    expect(html).toContain('进行中')
    expect(html).toContain('已用 12.3k token · 用时 1m 35s')
    expect(html).toContain('暂停')
    expect(html).not.toContain('>继续<')
    expect(html).toContain('aria-label="清除"')
  })

  it('暂停 / 卡住时能继续；完成了只能清除', () => {
    goals.p = goal({ status: 'paused' })
    expect(render('p')).toContain('继续')
    goals.b = goal({ status: 'blocked' })
    expect(render('b')).toContain('卡住了')
    goals.c = goal({ status: 'complete' })
    const done = render('c')
    expect(done).toContain('已完成')
    expect(done).not.toContain('>继续<')
    expect(done).not.toContain('>暂停<')
  })

  it('用量带预算；/goal 的结果提示', () => {
    expect(goalUsageText(goal({ tokenBudget: 50_000, timeUsedSeconds: 0 }))).toBe('已用 12.3k / 50k token')
    expect(goalResultText({ kind: 'get' }, goal({ status: 'paused' }))).toBe('当前目标（已暂停）：把测试修好')
    expect(goalResultText({ kind: 'get' }, null)).toBe('这个对话没有目标。输入 /goal 加上要达成的目标来设一个')
    expect(goalResultText({ kind: 'set', objective: '修 bug' }, goal())).toBe(
      '已设目标：修 bug。Codex 会一轮接一轮地做，直到完成；输入 /goal pause 暂停，/goal clear 清除',
    )
    expect(goalResultText({ kind: 'clear' }, null)).toBe('目标已清除')
  })
})
