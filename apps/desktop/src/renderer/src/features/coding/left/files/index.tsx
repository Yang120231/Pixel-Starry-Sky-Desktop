import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { DiffStat, cn } from '@/ui'
import { FileTree } from '@/features/files/FileTree'
import { useSession } from '@/features/engine'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { useCodingSessionId, useCodingWorkspace } from '../../workspace'
import { useTurnChanges } from '../../ai/useTurnChanges'
import { openCodeDiff } from '../../editor'
import { PanelHeader } from '../../shell/PanelHeader'
import { Section } from '../../shell/Section'
import { demoStatuses, kindTone, sortTurnFiles } from './filesModel'

/** 刷新键：会话从运行中变成别的状态、窗口重新获得焦点时加 1 */
function useRefreshKey(sessionId: string | null, visible: boolean): number {
  const [key, setKey] = useState(0)
  const state = useSession(sessionId)?.state
  const previous = useRef(state)
  useEffect(() => {
    if (previous.current === 'running' && state !== 'running') setKey(k => k + 1)
    previous.current = state
  }, [state])
  // 切回窗口时刷新，但 10 秒内只刷一次：每次 Alt-Tab 都整棵重读、跑好几条 git（docs/perf-audit-2026-10-18.md B5）
  const lastFocus = useRef(0)
  useEffect(() => {
    if (!visible) return
    const onFocus = (): void => {
      if (Date.now() - lastFocus.current < 10_000) return
      lastFocus.current = Date.now()
      setKey(k => k + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible])
  return key
}

/** 左栏「文件」：AI 这一轮改的 + 项目文件树 */
export function FilesView({ visible }: { visible: boolean }) {
  useI18n()
  const ws = useCodingWorkspace()
  const sessionId = useCodingSessionId()
  const turn = useTurnChanges(sessionId)
  const refreshKey = useRefreshKey(sessionId, visible)
  const files = useMemo(() => (turn ? sortTurnFiles(turn.files) : []), [turn])
  const statuses = useMemo(() => (isDemo ? demoStatuses(demo().git.status) : undefined), [])
  const ref = ws.ref
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={ws.name || tr('coding.files.title')} />
      {/* 两节各自滚动（AI 改动多时原来会压扁、溢出盖住下面的文件树）：AI 改动最多占四成高度，文件树占剩下的 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ref && turn && files.length > 0 ? (
          <Section
            id="ai-turn"
            className="max-h-[40%] shrink-0"
            title={tr('coding.files.aiTurn')}
            extra={
              turn.running ? (
                <span className="flex items-center gap-1 text-label font-normal text-fg-muted normal-case">
                  <span aria-hidden className="size-1.5 rounded-full bg-active" />
                  {tr('coding.files.aiTurnRunning')}
                </span>
              ) : undefined
            }
          >
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {files.map(f => (
                <li key={f.path}>
                  <button
                    type="button"
                    title={f.path}
                    aria-label={tr('coding.files.aiTurnOpen', { name: f.name })}
                    onClick={() => void openCodeDiff(ref, f.path)}
                    className="press no-drag flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-meta hover:bg-hover"
                  >
                    <span className={cn('min-w-0 flex-1 truncate', kindTone(f.kind))}>{f.name}</span>
                    <DiffStat added={f.added} removed={f.removed} className="text-label" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section id="tree" title={ws.name || tr('coding.files.title')} className="min-h-0 flex-1">
          {ref ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <FileTree
                requested={ref}
                scoped
                heading={false}
                refreshKey={refreshKey}
                statusColors="vscode"
                statuses={statuses}
              />
            </div>
          ) : (
            <p className="px-4 py-6 text-meta text-fg-muted">{tr('coding.files.noProject')}</p>
          )}
        </Section>
      </div>
    </div>
  )
}
