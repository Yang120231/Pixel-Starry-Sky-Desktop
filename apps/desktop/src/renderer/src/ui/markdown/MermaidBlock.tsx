// 回复里的 mermaid 代码块（docs/ui/mermaid.md）：默认画成图，可切回源码、复制源码、放大；
// 回复还在输出时先显示源码，写完再画；渲染失败退回源码并提示原因
import { createContext, memo, useContext, useEffect, useState } from 'react'
import { AlertTriangle, Maximize2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { CodeBlock } from '@/ui/code/CodeBlock'
import { cn } from '@/ui/cn'
import { ImageViewer } from '@/ui/ImageViewer'
import { Spinner } from '@/ui/Spinner'
import { describeMermaidError, renderMermaid, svgDataUrl, useThemeVars } from './mermaid'

/** 回复还在流式输出（Markdown 的流式分支提供） */
export const StreamingContext = createContext(false)

const CACHE_LIMIT = 50
// 画好的图按（主题, 源码）缓存：长对话折叠后再展开、流式换成完整渲染时块会重新挂载，不用再显示「加载中」
const cache = new Map<string, string>()
const remember = (key: string, svg: string): void => {
  cache.set(key, svg)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

type Outcome = { key: string; svg: string } | { key: string; error: { line: number | null; reason: string } }

/** null：还在加载（或不需要画） */
function useDiagram(code: string, enabled: boolean, attempt: number) {
  const vars = useThemeVars()
  const cacheKey = `${JSON.stringify(vars)}\n${code}`
  const key = `${attempt}\n${cacheKey}`
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const cached = cache.get(cacheKey)
  useEffect(() => {
    if (!enabled || cached) return
    let stale = false
    renderMermaid(code, vars).then(
      svg => {
        remember(cacheKey, svg)
        if (!stale) setOutcome({ key, svg })
      },
      (e: unknown) => {
        if (!stale) setOutcome({ key, error: describeMermaidError(e) })
      },
    )
    return () => {
      stale = true
    }
  }, [code, vars, enabled, cached, key, cacheKey])
  if (cached) return { svg: cached }
  return outcome?.key === key ? outcome : null
}

const iconButton =
  'press no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted'

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  useI18n()
  const streaming = useContext(StreamingContext)
  const text = code.endsWith('\n') ? code.slice(0, -1) : code
  const [showSource, setShowSource] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const result = useDiagram(text, !streaming, attempt)
  const svg = result && 'svg' in result ? result.svg : null
  const error = result && 'error' in result ? result.error : null

  if (streaming) return <CodeBlock code={code} lang="mermaid" />

  const diagram = !!svg && !showSource
  const tools = (
    <>
      <span
        role="group"
        aria-label={tr('mermaid.switch')}
        className={cn('inline-flex rounded-md bg-subtle p-px text-meta', !svg && 'opacity-50')}
      >
        {[false, true].map(source => {
          const on = source ? !diagram : diagram
          return (
            <button
              key={String(source)}
              type="button"
              disabled={!svg}
              aria-pressed={on}
              onClick={() => setShowSource(source)}
              className={cn(
                'rounded-[5px] px-2 leading-5',
                on ? 'border border-line-card bg-surface text-fg' : 'text-fg-muted hover:text-fg',
                !svg && 'cursor-default',
              )}
            >
              {source ? tr('mermaid.source') : tr('mermaid.view')}
            </button>
          )
        })}
      </span>
      <button
        type="button"
        className={iconButton}
        disabled={!svg}
        title={tr('mermaid.zoom')}
        aria-label={tr('mermaid.zoom')}
        onClick={() => setZoomed(true)}
      >
        <Maximize2 size={13} strokeWidth={1.5} />
      </button>
    </>
  )
  const notice = error && (
    <div className="flex items-start gap-1.5 border-b border-line-subtle bg-[color-mix(in_srgb,var(--danger)_8%,var(--bg-surface))] px-3 py-1.5 text-meta text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">
        {tr('mermaid.failed', {
          reason: (error.line ? tr('mermaid.failedLine', { line: error.line }) : '') + error.reason,
        })}
      </span>
      <button
        type="button"
        className="ml-auto shrink-0 whitespace-nowrap text-fg-muted hover:text-fg"
        onClick={() => setAttempt(n => n + 1)}
      >
        {tr('mermaid.retry')}
      </button>
    </div>
  )
  const view = diagram ? (
    <div className="flex justify-center bg-surface px-3 py-3.5">
      <img
        src={svgDataUrl(svg)}
        alt={tr('mermaid.diagramLabel')}
        draggable={false}
        onDoubleClick={() => setZoomed(true)}
        className="h-auto max-w-full"
      />
    </div>
  ) : !result ? (
    <div className="flex items-center justify-center gap-2 bg-surface px-3 py-6 text-meta text-fg-muted">
      <Spinner size={13} />
      {tr('mermaid.loading')}
    </div>
  ) : undefined

  return (
    <>
      <CodeBlock code={code} lang="mermaid" tools={tools} notice={notice} view={view} />
      {zoomed && svg && <ImageViewer src={svgDataUrl(svg)} name="mermaid" onClose={() => setZoomed(false)} />}
    </>
  )
})
