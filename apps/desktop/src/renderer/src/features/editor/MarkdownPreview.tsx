import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { List } from 'lucide-react'
import { cn, IconButton } from '@/ui'
import { motionEnabled } from '@/features/panes/motion'
import { Markdown } from '@/ui/markdown/Markdown'

interface Heading {
  id: string
  text: string
  level: number
}

/** 预览区域窄于这个宽度不显示目录 */
const TOC_MIN_WIDTH = 820
/** 判断「当前标题」时，标题顶部离滚动区顶部的容差 */
const ACTIVE_OFFSET = 24

/** 勾选框画成小方框（只读，不发灰），选中用强调色 */
const CHECKBOX = [
  '[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-1',
  '[&_li>input[type=checkbox]]:mr-2 [&_li>input[type=checkbox]]:size-3.5 [&_li>input[type=checkbox]]:translate-y-[2px]',
  '[&_li>input[type=checkbox]]:appearance-none [&_li>input[type=checkbox]]:rounded-[4px] [&_li>input[type=checkbox]]:border [&_li>input[type=checkbox]]:border-line-strong [&_li>input[type=checkbox]]:bg-transparent',
  "[&_li>input[type=checkbox]:checked]:border-accent [&_li>input[type=checkbox]:checked]:bg-accent [&_li>input[type=checkbox]:checked]:bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3 7.5l2.5 2.5L11 4.5' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")]",
  '[&_li>input[type=checkbox]:disabled]:opacity-100',
].join(' ')

/** 文档的标题层级（对话里 h1 / h2 一样大，文档要分得开）：GitHub 式，h1 / h2 下面一条细线 */
const HEADINGS = [
  '[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-line-subtle [&_h1]:pb-2 [&_h1]:text-[1.75em] [&_h1]:leading-tight',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-line-subtle [&_h2]:pb-1.5 [&_h2]:text-[1.35em] [&_h2]:leading-snug',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[1.12em]',
  '[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-semibold [&_h4]:text-fg',
].join(' ')

/** 滚动区里 id 对应的标题 */
function headingEl(scroller: HTMLElement, id: string): HTMLElement | null {
  for (const el of scroller.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id]')) if (el.id === id) return el
  return null
}

/**
 * .md 文件的预览（docs/ui/markdown-preview.md）：对话那套样式的文档模式 + 居中一栏 + 右边目录。
 * 双击块 → onJump(源码行)；`#锚点` 链接在预览里滚过去。
 */
export function MarkdownPreview({ text, onJump }: { text: string; onJump(line: number): void }) {
  useI18n()
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [wide, setWide] = useState(false)
  // 窄的时候目录收成右上角一个按钮，点了弹出
  const [tocOpen, setTocOpen] = useState(false)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(() => setWide(el.clientWidth >= TOC_MIN_WIDTH))
    observer.observe(el)
    setWide(el.clientWidth >= TOC_MIN_WIDTH)
    return () => observer.disconnect()
  }, [])

  // 目录的标题从渲染好的 DOM 里读
  useLayoutEffect(() => {
    const list = Array.from(scroller.current?.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id]') ?? [], el => ({
      id: el.id,
      text: el.textContent ?? '',
      level: Number(el.tagName[1]),
    }))
    setHeadings(prev =>
      prev.length === list.length && prev.every((h, i) => h.id === list[i]?.id && h.text === list[i]?.text)
        ? prev
        : list,
    )
  }, [text])

  // 点目录 / 锚点跳去的标题：文档短、滚到底时标题到不了顶上，这时高亮它（往上滚离开底部后作废）
  const target = useRef<string | null>(null)
  const updateCurrent = useCallback(() => {
    const box = scroller.current
    if (!box) return
    const atBottom = box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2
    if (!atBottom) target.current = null
    const top = box.getBoundingClientRect().top + ACTIVE_OFFSET
    const bottom = box.getBoundingClientRect().bottom
    let found: string | null = null
    let lastVisible: string | null = null
    for (const el of box.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id]')) {
      const y = el.getBoundingClientRect().top
      if (y <= top) found = el.id
      if (y < bottom) lastVisible = el.id
    }
    if (atBottom) found = target.current ?? lastVisible ?? found
    setCurrent(found ?? headings[0]?.id ?? null)
  }, [headings])
  useEffect(() => {
    updateCurrent()
  }, [updateCurrent])

  const scrollTo = (id: string): void => {
    const box = scroller.current
    const el = box && headingEl(box, id)
    if (!box || !el) return
    target.current = id
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8
    // 关了动画（或系统要求减少动态效果）时直接跳过去
    box.scrollTo({ top, behavior: motionEnabled() ? 'smooth' : 'auto' })
  }

  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null
    if (!link) return
    e.preventDefault()
    e.stopPropagation()
    let id = link.getAttribute('href')?.slice(1) ?? ''
    try {
      id = decodeURIComponent(id)
    } catch {
      /* 保持原样 */
    }
    scrollTo(id)
  }

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const block = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-line]') : null
    const line = Number(block?.dataset.line)
    if (line > 0) onJump(line)
  }

  const hasToc = headings.length >= 2
  const showToc = wide && hasToc
  const tocList = (after?: () => void) => (
    <ul className="flex flex-col gap-0.5">
      {headings.map(h => (
        <li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}>
          <button
            type="button"
            title={h.text}
            aria-current={h.id === current ? 'location' : undefined}
            className={cn(
              'press block w-full truncate rounded-md px-2 py-1 text-left text-meta hover:bg-hover',
              h.id === current ? 'bg-selected text-fg' : 'text-fg-muted',
            )}
            onClick={() => {
              scrollTo(h.id)
              after?.()
            }}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  )
  return (
    <div ref={root} data-markdown-preview className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={scroller}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
        onScroll={updateCurrent}
        onClickCapture={onClickCapture}
        onDoubleClick={onDoubleClick}
      >
        <div className="mx-auto w-full max-w-[760px] px-8 py-8">
          <Markdown document text={text} className={cn(HEADINGS, CHECKBOX)} />
        </div>
      </div>
      {showToc && (
        <nav
          data-markdown-toc
          aria-label={tr('editor.preview.toc')}
          className="w-[180px] shrink-0 overflow-y-auto border-l border-line-layout py-8 pr-3 pl-4"
        >
          <p className="mb-2 text-label font-medium text-fg-muted">{tr('editor.preview.toc')}</p>
          {tocList()}
        </nav>
      )}
      {!wide && hasToc && (
        <div
          data-markdown-toc-toggle
          className="absolute top-2 right-4 flex flex-col items-end"
          onKeyDown={e => e.key === 'Escape' && setTocOpen(false)}
        >
          <IconButton
            icon={List}
            size={28}
            iconSize={15}
            label={tr('editor.preview.toc')}
            active={tocOpen}
            aria-expanded={tocOpen}
            onClick={() => setTocOpen(v => !v)}
          />
          {tocOpen && (
            <nav
              data-markdown-toc
              aria-label={tr('editor.preview.toc')}
              className="mt-1 max-h-[60vh] w-56 overflow-y-auto rounded-lg border border-line bg-popover p-2 shadow-popover"
            >
              {tocList(() => setTocOpen(false))}
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
