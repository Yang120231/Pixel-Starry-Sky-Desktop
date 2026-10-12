// 复制和代码块（docs/mobile-remote.md §17 第 5 项）：代码块带语言名和「复制」，按需高亮。
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { loadHighlighter, loadedHighlighter, type Highlighter } from './highlight'
import { cn } from './index'

/** 复制文字；剪贴板接口不让用时（局域网 http 不是安全上下文、个别 WebView）退回老办法 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 往下走老办法
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

/** 「复制」按钮：点了显示「已复制」一会儿 */
export function CopyButton({ text, label = '复制', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState<boolean | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const ok = await copyText(text)
    setDone(ok)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(null), 1500)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        'inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-meta active:bg-hover',
        done === false ? 'text-danger' : 'text-fg-muted',
        className,
      )}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? '已复制' : done === false ? '复制失败' : label}
    </button>
  )
}

/** Markdown 里的代码块：标题栏（语言名 + 复制）+ 横向滚动的代码 */
export function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const [highlight, setHighlight] = useState<Highlighter | null>(loadedHighlighter)
  useEffect(() => {
    if (highlight || !lang) return
    let alive = true
    loadHighlighter().then(
      f => alive && setHighlight(() => f),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [highlight, lang])
  return (
    <div className="code-block overflow-hidden rounded-lg border border-line-subtle bg-subtle">
      <div className="flex items-center justify-between border-b border-line-subtle pl-3 text-label text-fg-faint">
        <span className="truncate font-mono">{lang || '代码'}</span>
        <CopyButton text={code} />
      </div>
      <pre>
        <code>{highlight ? highlight(code, lang) : code}</code>
      </pre>
    </div>
  )
}

/** 文件名 → 高亮用的语言名（扩展名；Dockerfile、Makefile 这类按文件名） */
export function langOf(path: string): string | null {
  const name = path.split(/[\/]/).pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : null
}

/** 整个文件：左边行号，右边代码（按需高亮，不折行，横向滚动） */
export function FileText({ code, lang }: { code: string; lang: string | null }) {
  const [highlight, setHighlight] = useState<Highlighter | null>(loadedHighlighter)
  useEffect(() => {
    if (highlight || !lang) return
    let alive = true
    loadHighlighter().then(
      f => alive && setHighlight(() => f),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [highlight, lang])
  const lines = code.endsWith('\n') ? code.slice(0, -1).split('\n').length : code.split('\n').length
  const numbers = Array.from({ length: lines }, (_, i) => i + 1).join('\n')
  return (
    <div className="flex min-w-0 overflow-x-auto font-mono text-label leading-relaxed">
      <pre
        aria-hidden
        className="sticky left-0 shrink-0 border-r border-line-subtle bg-app px-2.5 py-2 text-right text-fg-faint select-none"
      >
        {numbers}
      </pre>
      <pre className="min-w-max flex-1 px-3 py-2 whitespace-pre text-fg-body">
        <code>{highlight ? highlight(code, lang) : code}</code>
      </pre>
    </div>
  )
}
