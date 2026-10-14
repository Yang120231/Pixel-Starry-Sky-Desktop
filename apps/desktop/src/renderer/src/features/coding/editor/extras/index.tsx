import type { Extension } from '@codemirror/state'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useRef, type JSX } from 'react'
import { tr } from '@/i18n/core'
import type { OpenFile } from '@/features/files/store'
import { useToast } from '@/ui'
import { PROBLEMS_READY, useProblems } from '../../problems'
import { codeLens, LENS_MAX_LINES } from './codeLens'
import { overviewRuler } from './overviewRuler'
import { enclosingSymbol } from './symbolsModel'

const NONE: readonly Extension[] = []
/** 面包屑算符号时的文件大小上限，再大每次按键都要重新扫一遍 */
const CRUMB_MAX_CHARS = 400_000

/** 文本超过 limit 行吗（数到 limit+1 个换行就停） */
function overLines(text: string, limit: number): boolean {
  let count = 0
  let at = -1
  while ((at = text.indexOf('\n', at + 1)) >= 0) if (++count >= limit) return true
  return false
}

/** 代码透镜 + 概览标尺；返回值 memo */
export function useEditorExtras(tab: OpenFile | null): readonly Extension[] {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  })
  const id = tab?.id ?? null
  const path = tab?.path ?? ''
  const head = tab?.head ?? null
  const text = tab?.document?.kind === 'text'
  const big = text && tab ? overLines(tab.draft, LENS_MAX_LINES) : false
  return useMemo(() => {
    if (!id || !text) return NONE
    const list: Extension[] = []
    if (!big) list.push(codeLens(id, path, message => toastRef.current(message)))
    list.push(overviewRuler(head))
    return list
  }, [id, path, head, text, big])
}

/** 面包屑后面的「› ƒ 名字」和问题计数 */
export function SymbolCrumb({ tab }: { tab: OpenFile }): JSX.Element | null {
  const problems = useProblems(tab.ref)
  const line = tab.cursor.line
  const draft = tab.draft
  const isText = tab.document?.kind === 'text'
  const symbol = useMemo(
    () => (isText && draft.length <= CRUMB_MAX_CHARS ? enclosingSymbol(draft, line, tab.path) : null),
    [isText, draft, line, tab.path],
  )
  if (!isText) return null
  const pending = tr('coding.editor.extras.prevProblem')
  return (
    <span className="ml-1 flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted" data-symbol-crumb>
      {symbol && (
        <span
          className="flex min-w-0 items-center gap-1"
          title={tr('coding.editor.extras.symbol', { name: symbol.name })}
        >
          <span aria-hidden>›</span>
          <span aria-hidden className="font-mono text-accent">
            {symbol.kind === 'class' ? 'C' : 'ƒ'}
          </span>
          <span className="truncate text-fg">{symbol.name}</span>
        </span>
      )}
      {PROBLEMS_READY && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={problems.errors ? 'text-danger' : undefined}
            title={tr('coding.editor.extras.errors', { n: problems.errors })}
          >
            {problems.errors}E
          </span>
          <span
            className={problems.warnings ? 'text-warn' : undefined}
            title={tr('coding.editor.extras.warnings', { n: problems.warnings })}
          >
            {problems.warnings}W
          </span>
          {/* 问题检查还没接入，上下箭头先不能点 */}
          <button type="button" disabled title={pending} aria-label={pending} className="opacity-40">
            <ChevronUp size={14} strokeWidth={1.5} className="shrink-0" />
          </button>
          <button
            type="button"
            disabled
            title={tr('coding.editor.extras.nextProblem')}
            aria-label={tr('coding.editor.extras.nextProblem')}
            className="opacity-40"
          >
            <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
          </button>
        </span>
      )}
    </span>
  )
}
