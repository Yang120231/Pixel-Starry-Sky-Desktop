import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui'
import { cacheHitRate } from '@/usage/aggregate'
import { dimLabel, formatCost, formatDuration, formatPercent, formatTime, formatTokens } from '@/usage/format'
import type { UsagePage, UsageRecord } from '@/usage/types'
import { ModelCell, TIME_COL_WIDTH, TimeCell, UsageDetailCard, UsageTable, type UsageColumn } from './UsageTable'

const OUTCOME: Record<UsageRecord['outcome'], { text: string; cls: string }> = {
  completed: {
    get text() {
      return tr('settings.usage.RecordsTable.message973')
    },
    cls: 'text-fg-muted',
  },
  interrupted: {
    get text() {
      return tr('settings.usage.RecordsTable.message974')
    },
    cls: 'text-warn',
  },
  failed: {
    get text() {
      return tr('session.live.agentTrace.message195')
    },
    cls: 'text-danger',
  },
}

/**
 * 和账号调用表同样的列顺序、宽度、隐藏规则（模板见 RemoteCallsTable）：
 * 时间 · 模型 · 会话 · 输入 · 缓存读 · 输出 · 费用 · 请求 · 耗时 · 结果。
 * 「客户端」位置换成「会话」，「首字」位置换成「请求次数」（本机记录没有首字延迟）。
 */
const COLUMNS: Array<UsageColumn<UsageRecord>> = [
  {
    key: 'time',
    get label() {
      return tr('settings.usage.RecordsTable.message975')
    },
    width: TIME_COL_WIDTH,
    render: r => <TimeCell text={formatTime(r.endedAt)} />,
    title: r => new Date(r.endedAt).toLocaleString('zh-CN'),
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'model',
    get label() {
      return tr('session.ModelSourceMenu.message291')
    },
    render: r => <ModelCell model={r.model} />,
    title: r => r.model,
    cellClass: () => 'font-mono text-meta text-fg-secondary',
  },
  {
    key: 'source',
    get label() {
      return tr('settings.usage.RecordsTable.message976')
    },
    hideBelow: 760,
    render: r => r.sessionTitle || tr('settings.usage.RecordsTable.message977'),
    title: r => r.sessionTitle,
    cellClass: () => 'text-fg',
  },
  {
    key: 'input',
    get label() {
      return tr('session.turnStatsData.message376')
    },
    width: 'w-[4em]',
    align: 'right',
    render: r => formatTokens(r.input + r.cacheWrite),
  },
  {
    key: 'cache',
    get label() {
      return tr('session.turnStatsData.message381')
    },
    width: 'w-[4.4em]',
    align: 'right',
    hideBelow: 680,
    render: r => formatTokens(r.cacheRead),
  },
  {
    key: 'output',
    get label() {
      return tr('session.live.SessionStrips.message275')
    },
    width: 'w-[4em]',
    align: 'right',
    render: r => formatTokens(r.output),
  },
  {
    key: 'cost',
    get label() {
      return tr('settings.replyStats.message851')
    },
    width: 'w-[5.6em]',
    align: 'right',
    render: r => formatCost(r.costUsd, r.costSource, r.billing),
  },
  {
    key: 'requests',
    get label() {
      return tr('settings.usage.RecordsTable.message978')
    },
    width: 'w-[3.4em]',
    align: 'right',
    hideBelow: 840,
    render: r => `${r.requests}`,
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'duration',
    get label() {
      return tr('session.live.AgentTracePanel.message204')
    },
    width: 'w-[4.8em]',
    align: 'right',
    hideBelow: 600,
    render: r => formatDuration(r.durationMs),
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'status',
    get label() {
      return tr('settings.usage.RecordsTable.message979')
    },
    width: 'w-[3.2em]',
    align: 'right',
    render: r => OUTCOME[r.outcome].text,
    cellClass: r => OUTCOME[r.outcome].cls,
  },
]

/** 本机记录：每一轮 × 每个模型一条，最新在前、分页；点一行展开详情 */
export function RecordsTable({
  page,
  pageSize,
  onPage,
  onOpenSession,
}: {
  page: UsagePage
  pageSize: number
  onPage: (offset: number) => void
  onOpenSession: (sessionId: string) => void
}) {
  useI18n()
  return (
    <UsageTable
      title={tr('settings.usage.RecordsTable.message980')}
      rows={page.records}
      rowKey={r => r.id}
      columns={COLUMNS}
      detail={r => <RecordDetail r={r} onOpenSession={onOpenSession} />}
      offset={page.offset}
      total={page.total}
      pageSize={pageSize}
      onPage={onPage}
    />
  )
}

function RecordDetail({ r, onOpenSession }: { r: UsageRecord; onOpenSession: (id: string) => void }) {
  useI18n()
  return (
    <UsageDetailCard
      fields={[
        [tr('settings.usage.RecordsTable.message976'), r.sessionTitle || tr('settings.usage.RecordsTable.message977')],
        [tr('sidebar.Sidebar.message398'), dimLabel('project', r.project ?? '')],
        [tr('session.ModelSourceMenu.message283'), dimLabel('engine', r.engine)],
        [tr('session.ModelSourceMenu.message310'), dimLabel('route', r.route)],
        [tr('settings.usage.RecordsTable.message981'), String(r.requests)],
        [tr('settings.usage.RecordsTable.message979'), OUTCOME[r.outcome].text],
        [tr('settings.usage.RecordsTable.message982'), formatTokens(r.input)],
        [tr('session.turnStatsData.message383'), formatTokens(r.cacheWrite)],
        [tr('session.turnStatsData.message381'), formatTokens(r.cacheRead)],
        [tr('session.live.SessionStrips.message275'), formatTokens(r.output)],
        [tr('settings.replyStats.message851'), formatCost(r.costUsd, r.costSource, r.billing)],
        [tr('settings.usage.KpiCards.message967'), formatPercent(cacheHitRate(r))],
        [tr('session.live.AgentTracePanel.message204'), formatDuration(r.durationMs)],
        [tr('settings.usage.RecordsTable.message984'), new Date(r.startedAt).toLocaleString('zh-CN')],
        [tr('settings.usage.RecordsTable.message985'), new Date(r.endedAt).toLocaleString('zh-CN')],
      ]}
      footer={
        <>
          <span className="selectable min-w-0 truncate font-mono text-label text-fg-faint" title={r.id}>
            {r.id}
          </span>
          <Button variant="ghost" icon={ExternalLink} onClick={() => onOpenSession(r.sessionId)}>
            {tr('settings.usage.RecordsTable.message986')}{' '}
          </Button>
        </>
      }
    />
  )
}
