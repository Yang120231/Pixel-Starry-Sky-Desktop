import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Kbd, cn } from '@/ui'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { OPEN_SEARCH } from '@/features/layout/shortcuts'
import { useCommandPalette } from '@/features/commands/CommandPaletteProvider'
import { useOpenSearch } from '@/features/search/SearchProvider'
import { setSearchShortcutOverride } from '@/features/search/shortcutOverride'
import { demoFileHits, searchFiles, type FileHit } from '@/features/search/fileSearch'
import { openFile } from '@/features/files/store'
import { FileIcon as FileTypeIcon } from '@/features/files/icons/FileIcon'
import { isIgnoredPath, partitionIgnored, useIgnoredSet } from '@/features/files/ignored'
import { useActiveCodeTab } from '../editor'
import { useCodingWorkspace } from '../workspace'
import { parseQuery } from './commandCenterModel'

/** 顶栏中间的命令中心按钮；挂载时接管 Ctrl+P（卸载时还给全局搜索） */
export function CommandCenterButton() {
  useI18n()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    setSearchShortcutOverride(show)
    return () => setSearchShortcutOverride(null)
  }, [])
  return (
    <>
      <button
        type="button"
        data-command-center-button
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tr('coding.top.cc.open')}
        onClick={() => setOpen(true)}
        className="flex h-7 w-full min-w-[200px] max-w-[480px] items-center gap-2 rounded-md border border-line-card bg-subtle px-2 text-list text-fg-muted hover:bg-hover aria-expanded:border-accent-line @max-[999px]:w-8 @max-[999px]:min-w-0 @max-[999px]:justify-center @max-[999px]:px-0"
      >
        <Search size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left @max-[999px]:hidden">{tr('coding.top.cc.placeholder')}</span>
        <Kbd className="@max-[999px]:hidden">{OPEN_SEARCH.label}</Kbd>
      </button>
      {open && <CommandCenter onClose={() => setOpen(false)} />}
    </>
  )
}

interface FileState {
  hits: FileHit[]
  loading: boolean
  error: boolean
}

function CommandCenter({ onClose }: { onClose: () => void }) {
  useI18n()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState(0)
  const [files, setFiles] = useState<FileState>({ hits: [], loading: false, error: false })
  const { ref } = useCodingWorkspace()
  const codeTab = useActiveCodeTab()
  // 被 .gitignore 忽略的文件排在后面、变暗
  const ignored = useIgnoredSet(ref)
  const hits = useMemo(() => partitionIgnored(files.hits, h => h.path, ignored), [files.hits, ignored])
  const palette = useCommandPalette()
  const openSearch = useOpenSearch()
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const q = parseQuery(text)
  const term = q.kind === 'file' ? q.term : ''

  useEffect(() => {
    input.current?.focus()
    const back = returnFocus.current
    return () => {
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [])

  // 文件：输入停顿 150ms 后再搜
  useEffect(() => {
    setSelected(0)
    if (!term || !ref) {
      setFiles({ hits: [], loading: false, error: false })
      return
    }
    let gone = false
    setFiles(f => ({ ...f, loading: true, error: false }))
    const timer = window.setTimeout(() => {
      const run = isDemo
        ? Promise.resolve(demoFileHits(ref, demo().files.contents, term, 'brief'))
        : searchFiles(ref, term, 'brief')
      run
        .then(r => {
          if (!gone) setFiles({ hits: r.hits.filter(h => h.line === null), loading: false, error: false })
        })
        .catch(() => {
          if (!gone) setFiles({ hits: [], loading: false, error: true })
        })
    }, 150)
    return () => {
      gone = true
      window.clearTimeout(timer)
    }
  }, [term, ref])

  const pick = useCallback(
    (hit: FileHit): void => {
      onClose()
      void openFile(hit.ref, hit.path)
    },
    [onClose],
  )
  const submit = (): void => {
    if (q.kind === 'file') {
      const hit = hits[selected]
      if (hit) pick(hit)
    } else if (q.kind === 'command') {
      // 输入的文字带不过去，命令面板自己从头输入
      onClose()
      palette.open()
    } else if (q.kind === 'chat') {
      // openSearch 看到别的 aria-modal 会直接返回，所以先关掉自己，等下一帧再开
      onClose()
      requestAnimationFrame(() => openSearch())
    } else if (q.kind === 'line' && q.line !== null && codeTab) {
      onClose()
      void openFile(codeTab.ref, codeTab.path, q.line)
    }
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = hits.length
      if (q.kind === 'file' && n) setSelected(s => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    }
  }

  let body: ReactNode
  if (q.kind === 'file') {
    if (!term) body = <Note>{tr('coding.top.cc.hint')}</Note>
    else if (!ref) body = <Note>{tr('coding.top.cc.noProject')}</Note>
    else if (files.error) body = <Note>{tr('coding.top.cc.failed')}</Note>
    else if (hits.length === 0)
      body = <Note>{tr(files.loading ? 'coding.top.cc.searching' : 'coding.top.cc.noFiles')}</Note>
    else
      body = (
        <ul role="listbox" className="max-h-80 overflow-auto p-1">
          {hits.map((hit, i) => {
            const slash = hit.path.lastIndexOf('/')
            const dim = isIgnoredPath(hit.path, ignored)
            return (
              <li
                key={hit.key}
                role="option"
                aria-selected={i === selected}
                onMouseEnter={() => setSelected(i)}
                onClick={() => pick(hit)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-list text-fg',
                  i === selected && 'bg-accent-soft',
                )}
              >
                <FileTypeIcon name={hit.path.slice(slash + 1)} kind="file" size={14} dim={dim} />
                <span className={cn('shrink-0', dim && 'text-fg-faint')}>{hit.path.slice(slash + 1)}</span>
                {slash > 0 && (
                  <span className="min-w-0 truncate text-meta text-fg-muted">{hit.path.slice(0, slash)}</span>
                )}
                {i === selected && (
                  <span aria-hidden className="ml-auto shrink-0 pl-2 text-meta text-fg-faint">
                    {tr('coding.top.cc.enterOpen')}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )
  } else if (q.kind === 'command') body = <Note>{tr('coding.top.cc.commandHint')}</Note>
  else if (q.kind === 'chat') body = <Note>{tr('coding.top.cc.chatHint')}</Note>
  else if (q.kind === 'symbol') body = <Note>{tr('coding.top.cc.symbolStub')}</Note>
  else if (q.line === null) body = <Note>{tr('coding.top.cc.lineBad')}</Note>
  else if (!codeTab) body = <Note>{tr('coding.top.cc.lineNoFile')}</Note>
  else body = <Note>{tr('coding.top.cc.lineGo', { p0: q.line })}</Note>

  return (
    <div className="no-drag fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('coding.top.cc.open')}
        data-command-center
        onMouseDown={e => e.stopPropagation()}
        className="pop-in absolute left-1/2 top-12 w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-lg border border-line-card bg-popover shadow-menu"
      >
        {/* 输入框聚焦时强调色描边 + 淡光晕，看得出焦点在这（docs/screenshots/command-center-focus-mock.html 方案 A） */}
        <div className="px-2 pt-2 pb-1.5">
          <div
            data-command-center-field
            className="flex h-9 items-center gap-2 rounded-md border border-line-card bg-subtle px-2.5 focus-within:border-accent-line focus-within:ring-[3px] focus-within:ring-accent-soft"
          >
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
            <input
              ref={input}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label={tr('coding.top.cc.input')}
              placeholder={tr('coding.top.cc.placeholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-list text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>
        {body}
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-meta text-fg-muted">{children}</p>
}
