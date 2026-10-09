import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState } from 'react'
import { Archive, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { Spinner } from '@/ui'
import type { Project } from '@/data'
import { SidebarEmpty, SidebarRow } from './SidebarSection'
import { SessionItem } from './SessionItem'
import { ProjectRow } from './ProjectRow'

/** 项目列表：点击项目展开 / 收起，下面缩进显示会话；右键项目打开项目菜单 */
export function ProjectTree({
  projects,
  selectedSessionId,
  onSelectSession,
}: {
  projects: Project[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}) {
  useI18n()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(projects.map(p => [p.id, !!p.expanded])),
  )
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setExpanded(s => ({ ...s, [id]: !s[id] }))

  return (
    <>
      {projects.map(p => {
        const open = expanded[p.id] ?? !!p.expanded
        const FolderIcon = open ? FolderOpen : Folder
        return (
          <div key={p.id} className="flex flex-col gap-px">
            <ProjectRow
              project={p}
              open={open}
              onToggle={() => toggle(p.id)}
              icon={FolderIcon}
              trailing={
                p.running ? (
                  <Spinner size={14} />
                ) : (
                  p.branch && (
                    <span className="max-w-24 shrink-0 truncate font-mono text-label text-fg-faint">{p.branch}</span>
                  )
                )
              }
            />
            {open && p.sessions.length === 0 && (
              <SidebarEmpty className="pl-9">{tr('sidebar.ProjectTree.noConversationsYet')}</SidebarEmpty>
            )}
            {open &&
              p.sessions.map(s => (
                <SessionItem key={s.id} session={s} selected={s.id === selectedSessionId} onSelect={onSelectSession} />
              ))}
            {open && !!p.archived?.length && (
              <>
                <SidebarRow
                  onClick={() => setArchivedOpen(state => ({ ...state, [p.id]: !state[p.id] }))}
                  aria-expanded={!!archivedOpen[p.id]}
                  className="pl-9 text-fg-muted"
                >
                  <Archive size={13} strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate text-meta">
                    {tr('session.archivedCount', { count: p.archived.length })}
                  </span>
                  <ChevronRight size={13} className={archivedOpen[p.id] ? 'rotate-90' : ''} />
                </SidebarRow>
                {archivedOpen[p.id] &&
                  p.archived.map(session => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      selected={session.id === selectedSessionId}
                      onSelect={onSelectSession}
                    />
                  ))}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
