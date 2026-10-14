import { useState } from 'react'
import { Bot, Check, ChevronsLeft, ChevronsRight, Server, Terminal as TerminalIcon } from 'lucide-react'
import type { ServiceDefinition } from '../../../../../shared/types/project-tools'
import { IconButton, cn } from '@/ui'
import { stripAnsi } from '@/ui/code/ansi'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useSession } from '@/features/engine'
import { TerminalPanel } from '@/features/terminal/TerminalPanel'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { useTerminalStore } from '@/features/terminal/store'
import { workspaceTerminals } from '@/features/terminal/workspace'
import { TERMINAL_LIST_WIDTH } from '../layoutModel'
import { codingLayout } from '../layoutStore'
import { useServices } from '../services'
import { useCodingSessionId, useCodingWorkspace } from '../workspace'
import { setOutputSource, useBottomState } from './aiCommands'
import { summarizeAiCommands, type AiCommandEntry } from './aiCommandsModel'

/** 终端页：左边是终端本体（不带自己的标题栏），右边是可收起的列表 */
export function TerminalTab({
  visible,
  commands,
  autoCollapsed,
}: {
  visible: boolean
  commands: readonly AiCommandEntry[]
  /** 窗口窄时布局算出来的「该收起」；用户手动点过就听用户的，布局状态跨过阈值再交还自动 */
  autoCollapsed: boolean
}) {
  useI18n()
  const [manual, setManual] = useState<boolean | null>(null)
  const [seenAuto, setSeenAuto] = useState(autoCollapsed)
  if (seenAuto !== autoCollapsed) {
    setSeenAuto(autoCollapsed)
    setManual(null)
  }
  const collapsed = manual ?? autoCollapsed
  const setCollapsed = (value: boolean): void => setManual(value)
  const store = useTerminalStore()
  const workspace = useCodingWorkspace()
  const { services } = useServices(workspace.ref)
  const { output } = useBottomState()
  const hasTerminals =
    workspaceTerminals(store.terminals, workspace.projectId, workspace.path, window.pixelsky?.platform === 'win32')
      .length > 0
  // 没有终端、只有带输出的服务时，终端页直接看服务输出（默认选运行中的，其次第一个）
  const withOutput = services.filter(s => s.output)
  const service = hasTerminals
    ? undefined
    : ((output?.kind === 'service' ? withOutput.find(s => s.id === output.id) : undefined) ??
      withOutput.find(s => s.status === 'running') ??
      withOutput[0])
  return (
    <div
      role="tabpanel"
      id="coding-bottom-page-terminal"
      aria-labelledby="coding-bottom-tab-terminal"
      className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex' : 'hidden')}
      inert={!visible}
    >
      {/* 裁掉溢出：终端变窄时 xterm 还没重排的那一帧不能画到右边列表上 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {service ? (
          <pre
            data-coding-service-output={service.id}
            className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-2 font-mono text-meta leading-5 whitespace-pre-wrap text-fg-body select-text"
          >
            {stripAnsi(service.output)}
          </pre>
        ) : (
          <TerminalPanel embedded chrome="bare" visible={visible} />
        )}
      </div>
      <div
        data-terminal-list
        data-collapsed={collapsed}
        className="relative flex shrink-0 border-l border-line-layout bg-panel"
        style={{ width: collapsed ? 28 : TERMINAL_LIST_WIDTH }}
      >
        {collapsed ? (
          <div className="flex w-full justify-center pt-1">
            <IconButton
              icon={ChevronsLeft}
              size={24}
              label={tr('coding.bottom.list.expand')}
              onClick={() => setCollapsed(false)}
            />
          </div>
        ) : (
          <TerminalList commands={commands} activeServiceId={service?.id} onCollapse={() => setCollapsed(true)} />
        )}
      </div>
    </div>
  )
}

function StateDot({ tone }: { tone: 'running' | 'failed' | 'idle' | 'busy' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'running' && 'bg-success',
        tone === 'failed' && 'bg-danger',
        tone === 'busy' && 'bg-warn',
        tone === 'idle' && 'bg-fg-faint',
      )}
    />
  )
}
function serviceTone(status: ServiceDefinition['status']): 'running' | 'failed' | 'idle' | 'busy' {
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'starting' || status === 'stopping') return 'busy'
  return 'idle'
}

function Heading({ children }: { children: string }) {
  return <div className="px-3 pt-2 pb-1 text-label font-medium tracking-wide text-fg-faint uppercase">{children}</div>
}
function Row({
  active,
  onClick,
  icon,
  children,
  trailing,
}: {
  active?: boolean
  onClick(): void
  icon: React.ReactNode
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'press no-drag flex h-7 w-full items-center gap-2 px-3 text-left text-meta',
        active ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  )
}

function TerminalList({
  commands,
  activeServiceId,
  onCollapse,
}: {
  commands: readonly AiCommandEntry[]
  activeServiceId?: string
  onCollapse(): void
}) {
  useI18n()
  const ui = useTerminalUi()
  const store = useTerminalStore()
  const workspace = useCodingWorkspace()
  const sessionId = useCodingSessionId()
  const title = useSession(sessionId)?.record.title
  const { services } = useServices(workspace.ref)
  const terminals = workspaceTerminals(
    store.terminals,
    workspace.projectId,
    workspace.path,
    window.pixelsky?.platform === 'win32',
  )
  const summary = summarizeAiCommands(commands)
  return (
    <nav aria-label={tr('coding.bottom.list.label')} className="flex min-h-0 w-full flex-col overflow-y-auto pb-2">
      <div className="flex items-center pr-1">
        <div className="flex-1">
          <Heading>{tr('coding.bottom.list.terminals')}</Heading>
        </div>
        <IconButton icon={ChevronsRight} size={24} label={tr('coding.bottom.list.collapse')} onClick={onCollapse} />
      </div>
      {terminals.length === 0 && (
        <div className="px-3 py-1 text-meta text-fg-faint">{tr('coding.bottom.list.empty')}</div>
      )}
      {terminals.map(record => (
        <Row
          key={record.id}
          active={ui.activeId === record.id || ui.split?.right === record.id}
          icon={<TerminalIcon size={14} strokeWidth={1.5} className="shrink-0" />}
          trailing={
            <StateDot tone={record.status === 'running' ? 'running' : record.status === 'starting' ? 'busy' : 'idle'} />
          }
          onClick={() => {
            ui.select(record.id)
            setOutputSource({ kind: 'terminal', id: record.id })
            codingLayout.showBottom('terminal')
          }}
        >
          {record.title}
        </Row>
      ))}
      {services.length > 0 && <Heading>{tr('coding.bottom.list.services')}</Heading>}
      {services.map(service => (
        <Row
          key={service.id}
          active={service.id === activeServiceId}
          icon={<Server size={14} strokeWidth={1.5} className="shrink-0" />}
          trailing={<StateDot tone={serviceTone(service.status)} />}
          onClick={() => {
            if (service.output) {
              setOutputSource({ kind: 'service', id: service.id })
              if (terminals.length > 0) codingLayout.showBottom('output')
            } else codingLayout.showRight('sandbox')
          }}
        >
          {service.name}
        </Row>
      ))}
      {commands.length > 0 && <Heading>{tr('coding.bottom.list.ai')}</Heading>}
      {commands.length > 0 && (
        <Row
          icon={<Bot size={14} strokeWidth={1.5} className="shrink-0" />}
          trailing={
            summary.running > 0 ? (
              <span title={tr('coding.bottom.list.aiRunning')}>
                <StateDot tone="busy" />
              </span>
            ) : (
              <Check
                size={13}
                strokeWidth={1.5}
                className="shrink-0 text-success"
                aria-label={tr('coding.bottom.list.aiDone')}
              />
            )
          }
          onClick={() => codingLayout.showBottom('aiCommands')}
        >
          {title ? tr('coding.bottom.list.aiRow', { title }) : tr('coding.bottom.list.aiRowUntitled')}
        </Row>
      )}
    </nav>
  )
}
