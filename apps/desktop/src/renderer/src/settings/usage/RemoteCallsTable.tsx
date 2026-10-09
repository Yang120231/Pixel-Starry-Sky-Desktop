import { formatCost } from '../../usage/format'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { CloudOff } from 'lucide-react'
import { formatDuration, formatTime, formatTokens } from '@/usage/format'
import type { RemoteCall, RemoteCallPage } from '@/usage/remote-types'
import { ModelCell, TIME_COL_WIDTH, TimeCell, UsageDetailCard, UsageTable, type UsageColumn } from './UsageTable'

const STATUS: Record<RemoteCall['status'], { text: string; cls: string }> = {
  success: { get text() { return tr("settings.usage.RemoteCallsTable.message987") }, cls: 'text-fg-muted' },
  error: { get text() { return tr("session.live.agentTrace.message195") }, cls: 'text-danger' },
  rate_limited: { get text() { return tr("settings.usage.RemoteCallsTable.message988") }, cls: 'text-warn' },
}

const CLIENT_LABEL: Record<RemoteCall['client'], string> = {
  get 'pixelsky-desktop'() { return tr("settings.usage.RemoteCallsTable.message989") },
  'jucode-cli': 'CLI',
  get api() { return tr("settings.usage.RemoteCallsTable.message990") },
  get unknown() { return tr("settings.usage.RemoteCallsTable.message991") },
}

/** 远端是实际扣费，不加 ≈（usage.md §9.1） */
function cost(c: RemoteCall): string {
  if (c.status !== 'success' || c.costUsd === null) return '—'
  return formatCost(c.costUsd, 'platform', c.billing)
}

/**
 * 两张表共用的列顺序（以账号调用为模板）：时间 · 模型 · 来源 · 输入 · 缓存读 · 输出 · 费用 · 首字 · 耗时 · 结果。
 * 窗口变窄时依次隐藏：首字 → 来源 → 缓存读 → 耗时，最窄时只剩 时间 · 模型 · 输入 · 输出 · 费用 · 结果。
 */
const COLUMNS: Array<UsageColumn<RemoteCall>> = [
  {
    key: 'time',
    get label() { return tr("settings.usage.RecordsTable.message975") },
    width: TIME_COL_WIDTH,
    render: (c) => <TimeCell text={formatTime(c.createdAt)} />,
    title: (c) => new Date(c.createdAt).toLocaleString('zh-CN'),
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'model',
    get label() { return tr("session.ModelSourceMenu.message291") },
    render: (c) => <ModelCell model={c.model} />,
    title: (c) => c.model,
    cellClass: () => 'font-mono text-meta text-fg-secondary',
  },
  { key: 'source', get label() { return tr("settings.usage.RemoteCallsTable.message992") }, hideBelow: 760, render: (c) => CLIENT_LABEL[c.client] },
  { key: 'input', get label() { return tr("session.turnStatsData.message376") }, width: 'w-[4em]', align: 'right', render: (c) => formatTokens(c.input + c.cacheWrite) },
  { key: 'cache', get label() { return tr("session.turnStatsData.message381") }, width: 'w-[4.4em]', align: 'right', hideBelow: 680, render: (c) => formatTokens(c.cacheRead) },
  { key: 'output', get label() { return tr("session.live.SessionStrips.message275") }, width: 'w-[4em]', align: 'right', render: (c) => formatTokens(c.output) },
  { key: 'cost', get label() { return tr("settings.usage.RemoteCallsTable.message993") }, width: 'w-[5.6em]', align: 'right', render: cost },
  {
    key: 'ttft',
    get label() { return tr("settings.usage.RemoteCallsTable.message994") },
    width: 'w-[3.6em]',
    align: 'right',
    hideBelow: 840,
    render: (c) => (c.firstTokenMs === null ? '—' : `${(c.firstTokenMs / 1000).toFixed(1)}s`),
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'duration',
    get label() { return tr("session.live.AgentTracePanel.message204") },
    width: 'w-[4.8em]',
    align: 'right',
    hideBelow: 600,
    render: (c) => formatDuration(c.durationMs),
    cellClass: () => 'text-fg-muted',
  },
  {
    key: 'status',
    get label() { return tr("settings.usage.RecordsTable.message979") },
    width: 'w-[3.2em]',
    align: 'right',
    render: (c) => STATUS[c.status].text,
    cellClass: (c) => STATUS[c.status].cls,
  },
]

/** 账号调用记录：每一次模型请求一条（docs/ui/usage.md §9.4）。点一行展开详情 */
export function RemoteCallsTable({
  page,
  pageSize,
  onPage,
}: {
  page: RemoteCallPage
  pageSize: number
  onPage: (offset: number) => void
}) {
  useI18n()
  return (
    <UsageTable
      title={tr("settings.usage.RemoteCallsTable.message995")}
      rows={page.calls}
      rowKey={(c) => c.id}
      columns={COLUMNS}
      detail={(c) => <CallDetail c={c} />}
      offset={page.offset}
      total={page.total}
      pageSize={pageSize}
      onPage={onPage}
    />
  )
}

function CallDetail({ c }: { c: RemoteCall }) {
  useI18n()
  return (
    <UsageDetailCard
      fields={[
        [tr("settings.usage.RemoteCallsTable.message992"), CLIENT_LABEL[c.client]],
        [tr("settings.usage.RemoteCallsTable.message996"), c.device ?? '—'],
        ['Key', c.keyName ?? '—'],
        [tr("settings.usage.RemoteCallsTable.message997"), c.stream ? tr("settings.usage.RemoteCallsTable.message998") : tr("settings.usage.RemoteCallsTable.message999")],
        ['HTTP', `${c.httpStatus}`],
        [tr("settings.usage.RecordsTable.message979"), STATUS[c.status].text],
        [tr("settings.usage.RecordsTable.message982"), formatTokens(c.input)],
        [tr("session.turnStatsData.message383"), formatTokens(c.cacheWrite)],
        [tr("session.turnStatsData.message381"), formatTokens(c.cacheRead)],
        [tr("session.live.SessionStrips.message275"), formatTokens(c.output)],
        [tr("settings.usage.RemoteCallsTable.message993"), formatCost(c.costUsd, 'platform', c.billing)],
        [tr("settings.usage.RemoteCallsTable.message1001"), c.firstTokenMs === null ? '—' : `${c.firstTokenMs} ms`],
        [tr("session.live.AgentTracePanel.message204"), formatDuration(c.durationMs)],
        [tr("settings.usage.RemoteCallsTable.message1002"), c.turnId ?? '—'],
        [tr("settings.usage.RemoteCallsTable.message1003"), new Date(c.createdAt).toLocaleString('zh-CN')],
      ]}
      footer={
        <span className="selectable min-w-0 truncate font-mono text-label text-fg-faint" title={c.id}>
          {c.id}
        </span>
      }
    />
  )
}

/** 远端接口还没上线时的占位（真实模式现在走到这里；docs/ui/usage.md §9.4） */
export function RemoteCallsPlaceholder({ onBack }: { onBack: () => void }) {
  useI18n()
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-subtle text-fg-muted">
        <CloudOff size={20} strokeWidth={1.5} />
      </span>
      <div className="mt-3 text-ui font-medium text-fg-secondary">{tr("settings.usage.RemoteCallsTable.message1004")}</div>
      <p className="mt-1 max-w-md text-meta text-fg-muted">{tr("settings.usage.RemoteCallsTable.message1005")} {' '}
        <code className="rounded-sm bg-subtle px-1 font-mono">pnpm dev:demo</code>{tr("settings.usage.RemoteCallsTable.message1006")} </p>
      <button type="button" onClick={onBack} className="mt-3 text-meta text-accent-fg hover:underline">{tr("settings.usage.RemoteCallsTable.message1007")} </button>
    </div>
  )
}

/** 未登录时的占位（docs/ui/usage.md §9.4） */
export function RemoteCallsSignInPlaceholder({ onSignIn }: { onSignIn: () => void }) {
  useI18n()
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-subtle text-fg-muted">
        <CloudOff size={20} strokeWidth={1.5} />
      </span>
      <div className="mt-3 text-ui font-medium text-fg-secondary">{tr("settings.usage.RemoteCallsTable.message1008")}</div>
      <p className="mt-1 max-w-md text-meta text-fg-muted">{tr("settings.usage.RemoteCallsTable.message1009")}</p>
      <button type="button" onClick={onSignIn} className="mt-3 text-meta text-accent-fg hover:underline">{tr("settings.usage.RemoteCallsTable.message1010")} </button>
    </div>
  )
}
