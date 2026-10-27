// 计划审阅（docs/ui/plan-review.md）：把计划切成段、拼「带意见继续完善」打回给 AI 的话
import { tr } from '../../../i18n/core'

export interface PlanSection {
  /** 段标题（去掉 #）；计划开头没有标题的那段为 null */
  title: string | null
  /** 这段的 Markdown 原文（含标题行） */
  text: string
  /** 这段正文的第一行（意见没选原文时引用它） */
  first: string
}

export interface PlanNote {
  id: string
  section: number
  /** 选中的原文；按段批注时为 null */
  quote: string | null
  text: string
}

export interface PlanDraft {
  notes: PlanNote[]
  whole: string
}

export const EMPTY_PLAN_DRAFT: PlanDraft = { notes: [], whole: '' }

/** 引用原文最多这么长 */
export const QUOTE_MAX = 80

const HEADING = /^ {0,3}(#{1,3})\s+(.*?)\s*#*\s*$/
// 反引号写成 \x60：源码里的反引号会让 i18n 防回归的扫描当成模板字符串的开头
const FENCE = /^ {0,3}(\x60{3,}|~{3,})/

const clip = (s: string): string => (s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX)}…` : s)

/** 按一到三级标题切段；代码块里的 # 不算标题 */
export function splitPlan(markdown: string): PlanSection[] {
  const sections: { title: string | null; lines: string[] }[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null
    } else if (f) fence = f[1]
    const h = fence || f ? null : HEADING.exec(line)
    if (h) sections.push({ title: h[2], lines: [line] })
    else if (sections.length) sections[sections.length - 1].lines.push(line)
    else sections.push({ title: null, lines: [line] })
  }
  return sections
    .map(s => {
      const body = s.lines.slice(s.title === null ? 0 : 1)
      const first = body.map(l => l.trim()).find(l => l && !FENCE.test(l)) ?? ''
      return { title: s.title, text: s.lines.join('\n').trim(), first: clip(first) }
    })
    .filter(s => s.text)
}

const filledNotes = (draft: PlanDraft): PlanNote[] => draft.notes.filter(n => n.text.trim())

/** 写了内容的意见条数（含整体意见） */
export const noteCount = (draft: PlanDraft): number => filledNotes(draft).length + (draft.whole.trim() ? 1 : 0)

/** 带意见打回的话；没写意见时为 undefined（引擎发默认的那句） */
export function refineMessage(sections: readonly PlanSection[], draft: PlanDraft): string | undefined {
  const parts = filledNotes(draft).map((n, i) => {
    const s = sections[n.section]
    const title = s?.title ?? tr('plan.untitled')
    const quote = n.quote ?? s?.first ?? ''
    return [tr('plan.noteHead', { i: i + 1, title }), ...(quote ? [`> ${quote}`] : []), n.text.trim()].join('\n')
  })
  if (draft.whole.trim()) parts.push(`${tr('plan.refineWhole')}\n${draft.whole.trim()}`)
  return parts.length ? `${tr('plan.refineIntro')}\n\n${parts.join('\n\n')}` : undefined
}

/** 选中的文字整理成引用：空白合成一个空格，过长截断 */
export const quoteOf = (selected: string): string => clip(selected.replace(/\s+/g, ' ').trim())

/**
 * 计划卡上按 Ctrl/⌘+Enter 做什么：跟着主按钮走。写了意见 → 带意见继续完善；没写意见、焦点在意见框里 → 不做事
 * （空框里按不该开始执行）；其余 → 开始执行
 */
export function planEnterAction(ctx: { notes: number; inPlanInput: boolean }): 'refine' | 'start' | null {
  if (ctx.notes > 0) return 'refine'
  return ctx.inPlanInput ? null : 'start'
}
