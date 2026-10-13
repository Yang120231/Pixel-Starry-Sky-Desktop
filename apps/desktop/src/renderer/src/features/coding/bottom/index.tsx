import { Eraser, Maximize2, Minimize2, Plus, SquareSplitHorizontal, X } from 'lucide-react'
import { IconButton, cn } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { codingLayout } from '../layoutStore'
import { useProblems } from '../problems'
import type { BottomTab } from '../types'
import { useCodingSessionId, useCodingWorkspace } from '../workspace'
import { useAiCommands } from './aiCommands'
import { AiCommandsTab } from './AiCommandsTab'
import { OutputTab } from './OutputTab'
import { PortsTab } from './PortsTab'
import { ProblemsTab } from './ProblemsTab'
import { TerminalTab } from './TerminalTab'
import { usePorts } from './usePorts'

export { revealAiCommand } from './aiCommands'

const TABS: BottomTab[] = ['terminal', 'aiCommands', 'output', 'problems', 'ports']

/** 底部面板：终端 | AI 命令 | 输出 | 问题 | 端口，右边是新建 / 分屏 / 清空 / 最大化 / 关闭 */
export function BottomPanel({ visible, tab, maximized }: { visible: boolean; tab: BottomTab; maximized: boolean }) {
  useI18n()
  const ui = useTerminalUi()
  const workspace = useCodingWorkspace()
  const sessionId = useCodingSessionId()
  const commands = useAiCommands(sessionId)
  const problems = useProblems(workspace.ref)
  const ports = usePorts(workspace)
  const counts: Partial<Record<BottomTab, number>> = {
    aiCommands: commands.length,
    problems: problems.errors + problems.warnings,
    ports: ports.length,
  }
  const inTerminal = tab === 'terminal'
  return (
    <div data-coding-bottom-panel className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div
          role="tablist"
          aria-label={tr('coding.bottom.tabs')}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
        >
          {TABS.map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`coding-bottom-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`coding-bottom-page-${id}`}
              data-coding-bottom-tab={id}
              onClick={() => codingLayout.showBottom(id)}
              className={cn(
                'press no-drag flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-2.5 text-ui',
                tab === id ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <span className="min-w-0 truncate">{tr(`coding.bottom.tab.${id}`)}</span>
              {counts[id] ? (
                <span className="shrink-0 rounded-full bg-hover px-1.5 text-meta text-fg-muted tabular-nums">
                  {counts[id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          <IconButton
            icon={Plus}
            label={tr('coding.bottom.newTerminal')}
            onClick={() => {
              codingLayout.showBottom('terminal')
              void ui.create()
            }}
          />
          {inTerminal && (
            <>
              <IconButton
                icon={SquareSplitHorizontal}
                label={tr('coding.bottom.splitTerminal')}
                disabled={!ui.activeId}
                onClick={() => void ui.splitRight()}
              />
              <IconButton
                icon={Eraser}
                label={tr('coding.bottom.clear')}
                disabled={!ui.activeId}
                onClick={() => void ui.request('clear')}
              />
            </>
          )}
          <IconButton
            icon={maximized ? Minimize2 : Maximize2}
            label={tr(maximized ? 'coding.bottom.restore' : 'coding.bottom.maximize')}
            onClick={() => codingLayout.setBottomMaximized(!maximized)}
          />
          <IconButton
            icon={X}
            label={tr('coding.bottom.close')}
            onClick={() => codingLayout.setOpen('bottom', false)}
          />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <TerminalTab visible={visible && inTerminal} commands={commands} />
        {tab === 'aiCommands' && <AiCommandsTab sessionId={sessionId} commands={commands} />}
        {tab === 'output' && <OutputTab workspace={workspace} commands={commands} sessionId={sessionId} />}
        {tab === 'problems' && <ProblemsTab />}
        {tab === 'ports' && <PortsTab workspace={workspace} ports={ports} />}
      </div>
    </div>
  )
}
