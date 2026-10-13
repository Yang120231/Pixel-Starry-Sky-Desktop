import { AlertTriangle, Bell, GitBranch, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { CountBadge } from '@/ui'
import { useGitStatus } from '@/features/panel/git/summary'
import { useMachines } from '@/features/machines/store'
import { useInbox } from '@/features/panel/inbox/useInbox'
import { navigateToItem } from '@/features/search/navigation'
import { fileIndent } from '@/features/editor/code/positions'
import { fileLanguage } from '@/features/editor/code/languages'
import { codingLayout } from '../layoutStore'
import { useProblems } from '../problems'
import { useCodingWorkspace, useCodingSessionId } from '../workspace'
import { useActiveCodeTab } from '../editor'
import { useCodingActivity } from './useCodingActivity'
import { branchText, cursorText, encodingText, newlineText } from './statusModel'

const PLAIN = 'flex h-6 shrink-0 cursor-default items-center gap-1 px-1.5 text-label'
const ITEM = 'flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-label hover:bg-hover hover:text-fg'

function Item({
  onClick,
  title,
  children,
  data,
}: {
  onClick?: () => void
  title?: string
  children: ReactNode
  data?: string
}) {
  if (!onClick)
    return (
      <span data-status-item={data} title={title} className={PLAIN}>
        {children}
      </span>
    )
  return (
    <button type="button" data-status-item={data} title={title} className={ITEM} onClick={onClick}>
      {children}
    </button>
  )
}

export function StatusBarLeft() {
  useI18n()
  const { ref } = useCodingWorkspace()
  const git = useGitStatus(ref)
  const problems = useProblems(ref)
  const sessionId = useCodingSessionId()
  const activity = useCodingActivity(sessionId)
  const branch = git ? branchText(git) : null
  return (
    <div className="flex min-w-0 items-center gap-1">
      {branch && (
        <Item data="branch" title={tr('coding.status.branch')} onClick={() => codingLayout.showLeft('git')}>
          <GitBranch size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="max-w-48 truncate">{branch}</span>
        </Item>
      )}
      <Item data="problems" title={tr('coding.status.problems')}>
        <XCircle size={14} strokeWidth={1.5} className="shrink-0" />
        <span>{problems.errors}</span>
        <AlertTriangle size={14} strokeWidth={1.5} className="ml-1 shrink-0" />
        <span>{problems.warnings}</span>
      </Item>
      {activity && sessionId && (
        <Item
          data="activity"
          title={tr('coding.status.activityHint')}
          onClick={() => {
            codingLayout.showRight('chat')
            if (activity.itemId) navigateToItem(sessionId, activity.itemId)
          }}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-warn" />
          <span className="max-w-96 truncate">{tr('coding.status.activity', { text: activity.text })}</span>
        </Item>
      )}
    </div>
  )
}

export function StatusBarRight() {
  useI18n()
  const tab = useActiveCodeTab()
  const machines = useMachines()
  const inbox = useInbox()
  const doc = tab?.document
  const machine = machines.machines.find(m => m.id === machines.currentId)
  return (
    <div className="flex min-w-0 items-center gap-1">
      {tab && doc?.kind === 'text' && (
        <>
          <Item data="cursor">
            <span>{cursorText(tab.cursor)}</span>
          </Item>
          <Item data="indent">
            <span>{fileIndent(tab.draft).label}</span>
          </Item>
          <Item data="encoding">
            <span>{encodingText(doc.bom)}</span>
          </Item>
          <Item data="newline">
            <span>{newlineText(doc.newline)}</span>
          </Item>
          <Item data="language">
            <span>{fileLanguage(tab.path)}</span>
          </Item>
        </>
      )}
      <Item data="machine" title={tr('coding.status.machine')}>
        <span className="max-w-40 truncate">{machine?.name || tr('machines.local')}</span>
      </Item>
      <Item data="inbox" title={tr('coding.status.inbox')} onClick={() => codingLayout.toggleRight('notifications')}>
        <Bell size={14} strokeWidth={1.5} className="shrink-0" />
        {inbox.length > 0 && <CountBadge count={inbox.length} />}
      </Item>
    </div>
  )
}
