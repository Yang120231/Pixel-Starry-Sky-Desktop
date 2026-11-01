import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { IconButton } from '@/ui'
import { stripAnsi } from '@/ui/code/ansi'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { subscribeTerminalHistory, terminalHistoryText, useTerminalStore } from '@/features/terminal/store'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { useServices } from '../services'
import type { CodingWorkspace } from '../workspace'
import { useBottomState } from './aiCommands'
import { useItemBody } from '@/features/session/live/itemBody'
import { entryOutput, type AiCommandEntry } from './aiCommandsModel'

/** 输出页：选中终端的历史文字、选中服务的输出，或选中 AI 命令的纯文本 */
export function OutputTab({
  workspace,
  commands,
  sessionId,
}: {
  workspace: CodingWorkspace
  commands: readonly AiCommandEntry[]
  sessionId: string | null
}) {
  useI18n()
  const { output } = useBottomState()
  const terminalUi = useTerminalUi()
  const store = useTerminalStore()
  const { services } = useServices(workspace.ref)
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => subscribeTerminalHistory(() => setTick(n => n + 1)), [])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  // 没选来源时看当前终端
  const source = output ?? (terminalUi.activeId ? { kind: 'terminal' as const, id: terminalUi.activeId } : null)
  const sourceKey = source ? JSON.stringify(source) : ''
  const aiEntry =
    source?.kind === 'ai' && source.sessionId === sessionId ? commands.find(c => c.id === source.itemId) : undefined
  // 快照里截过的输出（cutChars）取完整的再留最后一段
  const full = useItemBody(aiEntry?.item, true)
  const { title, text } = useMemo(() => {
    if (!source) return { title: '', text: '' }
    if (source.kind === 'terminal') {
      const record = store.terminals.find(t => t.id === source.id)
      return {
        title: record ? tr('coding.bottom.output.source.terminal', { name: record.title }) : '',
        text: record ? stripAnsi(terminalHistoryText(source.id)) : '',
      }
    }
    if (source.kind === 'service') {
      const service = services.find(s => s.id === source.id)
      return {
        title: service ? tr('coding.bottom.output.source.service', { name: service.name }) : '',
        text: service ? stripAnsi(service.output) : '',
      }
    }
    return {
      title: aiEntry ? tr('coding.bottom.output.source.ai', { name: aiEntry.command }) : '',
      text: aiEntry ? stripAnsi(entryOutput(aiEntry, full)) : '',
    }
    // tick 变了说明终端历史有新输出
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, store.terminals, services, aiEntry, full, tick])

  return (
    <div
      role="tabpanel"
      id="coding-bottom-page-output"
      aria-labelledby="coding-bottom-tab-output"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-4">
        <span className="min-w-0 flex-1 truncate text-meta text-fg-muted">{title}</span>
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? tr('coding.bottom.output.copied') : tr('coding.bottom.output.copy')}
          disabled={!text}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true))
          }}
        />
      </div>
      {text ? (
        <pre className="min-h-0 flex-1 overflow-auto px-4 pb-3 font-mono text-meta leading-5 whitespace-pre-wrap text-fg-body select-text">
          {text}
        </pre>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-meta text-fg-faint">
          {tr('coding.bottom.output.empty')}
        </div>
      )}
    </div>
  )
}
