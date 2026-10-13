// 设置 › 反馈 › 列表（docs/ui/feedback.md §2.2）
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, Dot, Segmented, Spinner, cn } from '@/ui'
import { SectionTitle, SettingRow } from '../settings/SettingRow'
import type { FeedbackSummary } from '../../../../shared/types/feedback'
import { errorText, isAuthExpired, matchesFilter, mergeThreads, type ListFilter } from './logic'
import { StatusWord, TypeChip, formatTime } from './parts'
import { feedbackApi, useFeedback } from './store'

export function FeedbackList({
  onOpen,
  onNew,
  onFailed,
}: {
  onOpen: (id: string) => void
  onNew: () => void
  onFailed: (e: unknown) => void
}) {
  useI18n()
  const state = useFeedback()
  const [filter, setFilter] = useState<ListFilter>('all')
  // 手动加载的更早几页；cursor 为 undefined 时用状态里第一页的游标
  const [older, setOlder] = useState<FeedbackSummary[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  const next = cursor === undefined ? state.nextBefore : cursor
  const all = mergeThreads(state.threads, older)
  const shown = all.filter(t => matchesFilter(t.status, filter))

  const loadOlder = async (): Promise<void> => {
    if (!next || loadingOlder) return
    setLoadingOlder(true)
    setOlderError(null)
    try {
      const page = await feedbackApi().list(next)
      setOlder(current => mergeThreads(current, page.threads))
      setCursor(page.nextBefore)
    } catch (e) {
      setOlderError(translateMessage(errorText(e)))
      if (isAuthExpired(e)) onFailed(e)
    } finally {
      setLoadingOlder(false)
    }
  }

  return (
    <section data-feedback-list>
      <SectionTitle>{tr('feedback.title')}</SectionTitle>
      <SettingRow
        title={tr('feedback.send')}
        description={tr('feedback.intro')}
        control={
          <Button icon={Plus} variant="primary" onClick={onNew} data-feedback-new>
            {tr('feedback.new')}
          </Button>
        }
      />

      {state.status === 'error' && (
        <p className="selectable mb-4 flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-meta text-danger">
          <span className="min-w-0 flex-1 break-all">
            {state.error ? translateMessage(state.error) : tr('feedback.retry')}
          </span>
          <button
            type="button"
            className="shrink-0 text-accent hover:underline"
            onClick={() =>
              void feedbackApi()
                .refresh()
                .catch(() => {})
            }
          >
            {tr('feedback.retry')}
          </button>
        </p>
      )}

      <div className="mt-2 mb-2 flex items-center justify-between gap-3 border-t border-line pt-5">
        <h4 data-setting-title={tr('feedback.mine')} className="text-label font-medium text-fg-muted">
          {tr('feedback.mine')}
        </h4>
        <Segmented<ListFilter>
          label={tr('feedback.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: tr('feedback.filterAll') },
            { value: 'open', label: tr('feedback.filterOpen') },
            { value: 'closed', label: tr('feedback.filterClosed') },
          ]}
        />
      </div>

      {all.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-ui text-fg-muted">{tr('feedback.empty')}</p>
          <Button onClick={onNew}>{tr('feedback.emptyAction')}</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-8 text-ui text-fg-muted">{tr('feedback.emptyFiltered')}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map(t => (
            <li key={t.id}>
              <Row thread={t} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}

      {olderError && <p className="selectable mt-2 text-meta text-danger">{olderError}</p>}
      {next && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? <Spinner size={13} /> : null}
            {tr('feedback.loadOlder')}
          </Button>
        </div>
      )}
    </section>
  )
}

function Row({ thread, onOpen }: { thread: FeedbackSummary; onOpen: (id: string) => void }) {
  useI18n()
  const preview = thread.preview.replace(/\s+/g, ' ').trim()
  return (
    <button
      type="button"
      data-feedback-item={thread.id}
      data-unread={thread.unread || undefined}
      onClick={() => onOpen(thread.id)}
      className="press flex w-full items-start gap-2.5 rounded-md border-b border-line-subtle px-2 py-2.5 text-left last:border-b-0 hover:bg-hover"
    >
      <span className="mt-[7px] flex w-2 shrink-0 justify-center">
        {thread.unread && <Dot tone="notify" size={7} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <TypeChip type={thread.type} />
          <span className={cn('min-w-0 flex-1 truncate text-ui text-fg', thread.unread && 'font-medium')}>
            {thread.title}
          </span>
          <StatusWord status={thread.status} />
          <span className="shrink-0 text-meta text-fg-faint">
            · {formatTime(thread.updatedAt, thread.status !== 'closed')}
          </span>
        </span>
        {preview && (
          <span className="mt-0.5 block truncate text-meta text-fg-muted">
            {thread.previewAuthor === 'team'
              ? tr('feedback.previewTeam', { p0: preview })
              : tr('feedback.previewYou', { p0: preview })}
          </span>
        )}
      </span>
    </button>
  )
}
