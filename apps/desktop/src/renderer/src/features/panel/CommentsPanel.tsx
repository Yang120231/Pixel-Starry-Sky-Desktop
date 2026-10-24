// 右侧「评论」（docs/ui/channels-collab-v2.md §7）：当前会话的所有评论，可以只看没解决的；代码评论也列在下面
import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Switch } from '@/ui'
import { navigateToItem } from '@/features/search/navigation'
import { usePaneState } from '@/features/panes/store'
import { focusedTab } from '@/features/panes/tree'
import { isSessionTab } from '@/features/panes/keepAlive'
import { CommentCard } from '@/features/session/TurnCommentCards'
import { panelComments, useTurnComments } from '@/features/session/turnComments'
import { useReviewComments } from '@/features/session/reviewComments'
import { useEngineState } from '@/features/engine/store'

/** 当前聚焦的会话标签（文件标签、新会话标签不算） */
function useFocusedSession(): string | null {
  const tab = usePaneState(s => focusedTab(s.layout))
  return tab && isSessionTab(tab) ? tab : null
}

export function CommentsPanel() {
  useI18n()
  const sessionId = useFocusedSession()
  const comments = useTurnComments(sessionId)
  const code = useReviewComments(sessionId).comments
  const items = useEngineState(s => (sessionId ? s.snapshots[sessionId]?.items : undefined))
  const [onlyOpen, setOnlyOpen] = useState(true)
  const shown = useMemo(() => panelComments(comments, items, onlyOpen), [comments, items, onlyOpen])
  if (!sessionId) return <p className="p-4 text-meta text-fg-faint">{tr('turnComment.panelNoSession')}</p>
  const empty = comments.length === 0 && code.length === 0
  return (
    <div data-comments-panel className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3 py-2">
        <span className="text-meta text-fg-muted">
          {tr('workspace.comments')} · {comments.length}
        </span>
        <label className="flex items-center gap-1.5 text-meta text-fg-muted">
          {tr('turnComment.onlyOpen')}
          <Switch checked={onlyOpen} onChange={setOnlyOpen} label={tr('turnComment.onlyOpen')} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {empty ? (
          <div className="flex flex-col gap-1 py-6 text-center">
            <p className="text-meta text-fg-muted">{tr('turnComment.panelEmpty')}</p>
            <p className="text-meta text-fg-faint">{tr('turnComment.panelHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map(c => (
              <CommentCard
                key={c.id}
                comment={c}
                sessionId={sessionId}
                onJump={() => navigateToItem(sessionId, c.turnKey)}
              />
            ))}
            {comments.length > 0 && shown.length === 0 && (
              <p className="py-3 text-center text-meta text-fg-faint">{tr('turnComment.panelAllResolved')}</p>
            )}
            {code.length > 0 && (
              <section className="mt-2 flex flex-col gap-1.5">
                <h3 className="text-meta font-medium text-fg-muted">
                  {tr('turnComment.codeSection')} · {code.length}
                </h3>
                {code.map(c => (
                  <div key={c.id} className="rounded-md border border-line-card bg-surface px-2.5 py-2">
                    <div className="truncate font-mono text-meta text-fg-faint">
                      {c.path}:{c.line}
                    </div>
                    <p className="text-ui whitespace-pre-wrap text-fg-body">{c.text}</p>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
