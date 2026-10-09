import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { AppWindow, ArrowLeft, ArrowRight, Globe, Lock, MessageSquareText, RotateCw } from 'lucide-react'
import { cn, IconButton, useComingSoon } from '@/components/ui'
import type { BrowserPage } from '@/mock/data'

interface BrowserToolbarProps {
  pages: BrowserPage[]
  activePageId: string
  onSelectPage: (id: string) => void
  url: string
  annotationCount: number
}

/** 浏览器页面标签行 + 导航行 */
export function BrowserToolbar({ pages, activePageId, onSelectPage, url, annotationCount }: BrowserToolbarProps) {
  useI18n()
  const comingSoon = useComingSoon()
  const AddressIcon = url ? Lock : Globe

  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">
      {pages.length > 0 && (
        <div className="flex min-w-0 items-center gap-1">
          {pages.map(page => {
            const Icon = page.kind === 'site' ? Globe : AppWindow
            const active = page.id === activePageId
            return (
              <button
                key={page.id}
                type="button"
                title={page.title}
                onClick={() => onSelectPage(page.id)}
                className={cn(
                  'press flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-list',
                  active
                    ? 'shrink-0 border-line bg-surface text-fg shadow-sm'
                    : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <Icon size={15} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{page.title}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <div className="flex shrink-0 items-center">
          <IconButton
            icon={ArrowLeft}
            label={tr('panel.BrowserToolbar.message80')}
            onClick={() => comingSoon(tr('panel.BrowserToolbar.message80'))}
          />
          <IconButton
            icon={ArrowRight}
            label={tr('panel.BrowserToolbar.message81')}
            onClick={() => comingSoon(tr('panel.BrowserToolbar.message81'))}
          />
          <IconButton
            icon={RotateCw}
            label={tr('account.AccountMenu.message45')}
            onClick={() => comingSoon(tr('account.AccountMenu.message45'))}
          />
        </div>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-list">
          <AddressIcon size={13} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
          {url ? (
            <span className="truncate text-fg-secondary">{url}</span>
          ) : (
            <span className="truncate text-fg-faint">{tr('panel.BrowserToolbar.message82')}</span>
          )}
        </div>
        {annotationCount > 0 && (
          <button
            type="button"
            onClick={() => comingSoon(tr('panel.BrowserToolbar.message83'))}
            className="press flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-list text-accent-fg hover:opacity-85"
          >
            <MessageSquareText size={15} strokeWidth={1.5} />
            {tr('panel.BrowserToolbar.message83')} {annotationCount}
          </button>
        )}
      </div>
    </div>
  )
}
