// 搜索框、项目筛选、对话内容的搜索结果（docs/mobile-remote.md §17 第 6 项、§18.3、§26）。
// 搜索框是灰底圆角框；搜索结果和会话行一样平铺在页面底色上，小标题 + 行间细线，不再套卡片。
import type { ReactNode } from 'react'
import { MessageSquareText, Search, X } from 'lucide-react'
import type { SearchResult } from '@pixelsky/protocol'
import { Spinner, cn } from './index'
import { L } from '@/i18n'

export function SearchField({
  value,
  onChange,
  placeholder,
  className = 'mx-4',
  keyTarget,
  hint,
}: {
  value: string
  onChange(value: string): void
  placeholder: string
  className?: string
  /** 快捷键聚焦用（platform/keys 的 focusTarget） */
  keyTarget?: 'search'
  /** 没输入时右边的提示（快捷键键帽） */
  hint?: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-xl bg-subtle px-3 text-fg-muted focus-within:text-fg-secondary',
        className,
      )}
    >
      <Search size={17} className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        {...(keyTarget ? { 'data-key-target': keyTarget } : {})}
        className="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {!value && hint}
      {value && (
        <button
          type="button"
          aria-label={L('清除', 'Clear')}
          onClick={() => onChange('')}
          className="-mr-1 p-1 text-fg-faint"
        >
          <X size={16} />
        </button>
      )}
    </label>
  )
}

/** 一排可以横着滑的选项（「全部」+ 各个项目） */
export function Chips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { value: T; label: string }[]
  value: T
  onChange(value: T): void
}) {
  return (
    <div role="radiogroup" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(i => (
        <button
          key={i.value}
          type="button"
          role="radio"
          aria-checked={i.value === value}
          onClick={() => onChange(i.value)}
          className={cn(
            'max-w-48 shrink-0 truncate rounded-full border px-3 py-1.5 text-meta',
            i.value === value
              ? 'border-transparent bg-primary text-primary-fg'
              : 'border-line-subtle bg-surface text-fg-secondary',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

/** 对话内容里搜到的：每个会话一条（最相关的那段），标题、项目名已经在手机上筛过的不重复列 */
export function ContentResults({
  results,
  loading,
  truncated,
  when,
  onOpen,
  className,
}: {
  results: readonly SearchResult[]
  loading: boolean
  truncated: boolean
  /** 「3 分钟前」 */
  when(at: number): string
  onOpen(sessionId: string): void
  className?: string
}) {
  const seen = new Set<string>()
  const hits = results.filter(r => {
    if (r.kind === 'title' || r.kind === 'project' || seen.has(r.sessionId)) return false
    seen.add(r.sessionId)
    return true
  })
  if (!hits.length && !loading) return null
  return (
    <section className={className}>
      <h2 className="flex items-center gap-1.5 px-5 pb-1 text-meta font-medium text-fg-muted">
        <MessageSquareText size={13} /> {L('对话内容', 'Conversation content')}
        {loading && <Spinner size={11} className="text-fg-faint" />}
      </h2>
      {hits.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.sessionId)}
          className="block w-full px-5 text-left active:bg-hover"
        >
          <span className="flex flex-col gap-1 border-b border-line-subtle py-2.5">
            <span className="line-clamp-1 text-list font-medium">
              {r.title.trim() || L('未命名会话', 'Untitled conversation')}
            </span>
            <span className="line-clamp-2 text-meta text-fg-muted">
              {r.snippet.map((f, j) =>
                f.match ? (
                  <mark key={j} className="rounded-sm bg-accent-soft px-0.5 text-accent-fg">
                    {f.text}
                  </mark>
                ) : (
                  <span key={j}>{f.text}</span>
                ),
              )}
            </span>
            <span className="text-label text-fg-faint">
              {r.projectName} · {when(r.updatedAt)}
              {(r.sessionMatches ?? 0) > 1 && <> · {L(`${r.sessionMatches} 处`, `${r.sessionMatches} matches`)}</>}
            </span>
          </span>
        </button>
      ))}
      {!hits.length && (
        <div className="flex items-center justify-center gap-2 py-4 text-meta text-fg-muted">
          <Spinner size={12} /> {L('正在搜对话内容…', 'Searching conversations…')}
        </div>
      )}
      {truncated && (
        <p className="px-5 py-2.5 text-label text-fg-faint">
          {L('结果较多，只显示最相关的', 'Many results; showing the most relevant')}
        </p>
      )}
    </section>
  )
}
