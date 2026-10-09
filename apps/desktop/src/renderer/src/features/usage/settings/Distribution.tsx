import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { Segmented, type SegmentedOption } from '@/ui'
import { totalTokens } from '@/features/usage/aggregate'
import { DIMENSION_LABEL, dimLabel, formatTokens, formatTotalCost } from '@/features/usage/format'
import type { UsageDimension, UsageGroupRow } from '@/features/usage/types'

const DIM_OPTIONS: Array<SegmentedOption<UsageDimension>> = (['model', 'project', 'engine', 'route'] as const).map(
  d => ({
    value: d,
    label: DIMENSION_LABEL[d],
  }),
)

/** 分布表：按模型 / 项目 / 引擎 / 线路切换；点一行把它加为筛选条件 */
export function Distribution({
  dim,
  onDim,
  rows,
  activeKey,
  onPick,
}: {
  dim: UsageDimension
  onDim: (d: UsageDimension) => void
  rows: UsageGroupRow[]
  /** 这个维度当前的筛选值（有筛选时只剩这一行） */
  activeKey: string | undefined
  onPick: (key: string) => void
}) {
  useI18n()
  const sum = rows.reduce((s, r) => s + totalTokens(r), 0)
  return (
    <div className="@container min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-ui font-medium text-fg">{tr('settings.usage.Distribution.distribution')}</h4>
        <Segmented
          label={tr('settings.usage.Distribution.distributionDimension')}
          options={DIM_OPTIONS}
          value={dim}
          onChange={onDim}
        />
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-meta text-fg-faint">{tr('settings.usage.Distribution.noData')}</p>
      ) : (
        <table className="w-full table-fixed text-list tabular-nums">
          <thead>
            <tr className="text-left text-meta text-fg-muted">
              <th className="w-[28%] pb-2 font-normal">{DIMENSION_LABEL[dim]}</th>
              <th className="w-[24%] pb-2 font-normal">{tr('settings.usage.Distribution.share')}</th>
              <th className="w-[12%] pb-2 text-right font-normal">Token</th>
              <th className="w-[11%] pb-2 text-right font-normal @max-[600px]:hidden">
                {tr('session.live.SessionStrips.output')}
              </th>
              <th className="w-[15%] pb-2 text-right font-normal">{tr('settings.replyStats.cost')}</th>
              <th className="w-[10%] pb-2 text-right font-normal @max-[520px]:hidden">
                {tr('settings.usage.Distribution.turns')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const share = sum > 0 ? totalTokens(r) / sum : 0
              const active = activeKey === r.key
              return (
                <tr
                  key={r.key}
                  onClick={() => !active && onPick(r.key)}
                  title={
                    active
                      ? tr('settings.usage.Distribution.filteredByThisItem')
                      : tr('settings.usage.Distribution.clickToFilterBy')
                  }
                  className="cursor-default border-t border-line-subtle hover:bg-hover"
                >
                  <td className="truncate py-2 pr-3 text-fg" title={dimLabel(dim, r.key)}>
                    {dimLabel(dim, r.key)}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(2, share * 100)}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-meta text-fg-muted">{Math.round(share * 100)}%</span>
                    </div>
                  </td>
                  <td className="truncate py-2 text-right text-fg-secondary">{formatTokens(totalTokens(r))}</td>
                  <td className="truncate py-2 text-right text-fg-secondary @max-[600px]:hidden">
                    {formatTokens(r.output)}
                  </td>
                  <td className="truncate py-2 text-right text-fg-secondary">{formatTotalCost(r)}</td>
                  <td className="truncate py-2 text-right text-fg-secondary @max-[520px]:hidden">{r.turns}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
