import { useMemo, useState } from 'react'
import { ChevronDown, Play } from 'lucide-react'
import { Button, cn } from '@/ui'
import { stripAnsi } from '@/ui/code/ansi'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useSession } from '@/features/engine'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { terminalRunWhenReady, terminalState } from '@/features/terminal/store'
import { codingLayout } from '../layoutStore'
import { selectAiCommand, setOutputSource, useBottomState } from './aiCommands'
import { commandTone, type AiCommandEntry } from './aiCommandsModel'

const TONE_COLOR = { running: 'bg-warn', failed: 'bg-danger', done: 'bg-success' } as const

/** 鼠标悬停时显示的完整命令（列表和标题都截断成一行） */
const fullTitle = (command: AiCommandEntry): string =>
  command.description
    ? `${command.command}

${command.description}`
    : command.command

/** AI 命令页：左边命令列表，右边选中命令的只读输出 */
export function AiCommandsTab({
  sessionId,
  commands,
}: {
  sessionId: string | null
  commands: readonly AiCommandEntry[]
}) {
  useI18n()
  const ui = useTerminalUi()
  const { selected } = useBottomState()
  // 只有 Claude Code 跑完命令才把输出交回来；像素星空、Codex 边跑边推，运行中没输出就是还没打印
  const claude = useSession(sessionId)?.record.engine === 'claude'
  const current =
    selected && selected.sessionId === sessionId ? commands.find(c => c.id === selected.itemId) : undefined
  // 没选过时默认看最后一条
  const entry = current ?? commands[commands.length - 1]
  const text = useMemo(() => (entry ? stripAnsi(entry.output) : ''), [entry])

  const rerun = async (command: string): Promise<void> => {
    const before = new Set(terminalState().terminals.map(t => t.id))
    const ok = await ui.create()
    const record = terminalState().terminals.find(t => !before.has(t.id))
    if (!ok || !record) return
    terminalRunWhenReady(record.id, command)
    setOutputSource({ kind: 'terminal', id: record.id })
    codingLayout.showBottom('terminal')
  }

  return (
    <div
      role="tabpanel"
      id="coding-bottom-page-aiCommands"
      aria-labelledby="coding-bottom-tab-aiCommands"
      className="flex min-h-0 min-w-0 flex-1"
    >
      {!sessionId || commands.length === 0 || !entry ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-meta text-fg-faint">
          {tr(sessionId ? 'coding.bottom.ai.empty' : 'coding.bottom.ai.noSession')}
        </div>
      ) : (
        <>
          <ul
            aria-label={tr('coding.bottom.ai.list')}
            className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line-layout py-1"
          >
            {commands.map(command => (
              <li key={command.id}>
                <button
                  type="button"
                  data-coding-ai-command={command.id}
                  title={fullTitle(command)}
                  aria-current={command.id === entry.id}
                  onClick={() => selectAiCommand(sessionId, command.id)}
                  className={cn(
                    'press no-drag flex w-full items-start gap-2 px-3 py-1.5 text-left',
                    command.id === entry.id ? 'bg-selected' : 'hover:bg-hover',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 inline-block size-1.5 shrink-0 rounded-full',
                      TONE_COLOR[commandTone(command)],
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-meta text-fg">{command.command}</span>
                    {command.description && (
                      <span className="block truncate text-label text-fg-faint">{command.description}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-1">
              <div className="min-w-0 flex-1">
                <CommandTitle key={entry.id} command={entry} />
                <div className="flex min-w-0 gap-2 text-label text-fg-faint">
                  <span className="shrink-0">{tr(`coding.bottom.ai.status.${entry.status}`)}</span>
                  {entry.exitCode !== null && (
                    <span className="shrink-0">{tr('coding.bottom.ai.exitCode', { code: entry.exitCode })}</span>
                  )}
                  {entry.subagent && (
                    <span className="min-w-0 truncate" title={entry.subagent}>
                      {tr('coding.bottom.ai.subagent', { name: entry.subagent })}
                    </span>
                  )}
                </div>
              </div>
              <Button onClick={() => void rerun(entry.command)}>
                <Play size={14} strokeWidth={1.5} className="shrink-0" />
                {tr('coding.bottom.ai.rerun')}
              </Button>
            </div>
            {entry.status === 'running' && !text && (
              <div className="px-4 pb-1 text-meta text-fg-muted">
                {tr(claude ? 'coding.bottom.ai.runningNote' : 'coding.bottom.ai.waitingOutput')}
              </div>
            )}
            {text ? (
              <pre className="min-h-0 flex-1 overflow-auto px-4 pb-3 font-mono text-meta leading-5 whitespace-pre-wrap text-fg-body select-text">
                {text}
              </pre>
            ) : (
              entry.status !== 'running' && (
                <div className="px-4 text-meta text-fg-faint">{tr('coding.bottom.ai.noOutput')}</div>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** 右边的命令标题：平时一行，悬停显示完整命令，点一下展开成多行（可选中复制），再点收起 */
function CommandTitle({ command }: { command: AiCommandEntry }) {
  useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 items-start gap-1">
      <div
        data-coding-ai-title
        title={open ? undefined : fullTitle(command)}
        onClick={() => {
          // 展开后拖选文字不收起
          if (!open || !window.getSelection()?.toString()) setOpen(v => !v)
        }}
        className={cn(
          'min-w-0 flex-1 cursor-pointer font-mono text-meta text-fg',
          open ? 'max-h-40 overflow-y-auto break-all whitespace-pre-wrap select-text' : 'truncate',
        )}
      >
        {command.command}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={tr(open ? 'coding.bottom.ai.collapseCommand' : 'coding.bottom.ai.expandCommand')}
        title={tr(open ? 'coding.bottom.ai.collapseCommand' : 'coding.bottom.ai.expandCommand')}
        onClick={() => setOpen(v => !v)}
        className="press no-drag -my-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
      >
        <ChevronDown size={13} strokeWidth={1.5} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  )
}
