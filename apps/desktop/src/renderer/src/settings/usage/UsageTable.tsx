import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Fragment, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton, cn } from '@/components/ui'

/**
 * 用量页两张明细表（本机记录 / 账号调用）共用的表格骨架（docs/ui/usage.md §9.4，以账号调用为模板）。
 * - 数字、时间、结果这些短列给固定宽度（em，跟着字号缩放），模型 / 来源列分剩下的空间；
 *   设置窗口变宽变窄时只有模型 / 来源列跟着伸缩，数字列不会被截成省略号。
 * - 窗口变窄时按 `hideBelow` 依次隐藏次要列（容器查询，看的是表格自己的宽度，不是整个窗口）。
 * - 点一行展开详情，展开 / 收起带动画（globals.css .usage-expand）。
 */
export interface UsageColumn<T> {
  key: string
  label: string
  /** 固定列宽（Tailwind 类，用 em 跟着字号缩放）；不写表示和其他不写的列平分剩余宽度 */
  width?: string
  align?: 'left' | 'right'
  /** 表格宽度小于这个值时隐藏这一列（px）；不写表示一直显示 */
  hideBelow?: 520 | 600 | 680 | 760 | 840
  /** 单元格样式（颜色、等宽字体等） */
  cellClass?: (row: T) => string
  render: (row: T) => ReactNode
  /** 悬停提示（截断时看完整内容） */
  title?: (row: T) => string
}

const HIDE: Record<NonNullable<UsageColumn<unknown>['hideBelow']>, string> = {
  520: '@max-[520px]:hidden',
  600: '@max-[600px]:hidden',
  680: '@max-[680px]:hidden',
  760: '@max-[760px]:hidden',
  840: '@max-[840px]:hidden',
}

interface UsageTableProps<T> {
  title: string
  rows: T[]
  rowKey: (row: T) => string
  columns: Array<UsageColumn<T>>
  /** 展开后的详情 */
  detail: (row: T) => ReactNode
  /** 分页 */
  offset: number
  total: number
  pageSize: number
  onPage: (offset: number) => void
}

export function UsageTable<T>({ title, rows, rowKey, columns, detail, offset, total, pageSize, onPage }: UsageTableProps<T>) {
  useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + rows.length, total)

  return (
    <div className="@container min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="min-w-0 truncate text-ui font-medium text-fg">{title}</h4>
        <div className="flex shrink-0 items-center gap-1 text-meta text-fg-muted tabular-nums">
          <span className="mr-1">
            {from}–{to} / {total}
          </span>
          <IconButton icon={ChevronLeft} label={tr("settings.usage.UsageTable.message1027")} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))} />
          <IconButton icon={ChevronRight} label={tr("settings.usage.UsageTable.message1028")} disabled={to >= total} onClick={() => onPage(offset + pageSize)} />
        </div>
      </div>

      <table className="w-full table-fixed text-list tabular-nums">
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} className={cn(c.width, c.hideBelow && HIDE[c.hideBelow])} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-meta text-fg-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'truncate pb-2 font-normal',
                  c.align === 'right' ? 'pl-2 text-right' : 'pr-2 text-left',
                  c.hideBelow && HIDE[c.hideBelow],
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row)
            const expanded = open === id
            return (
              <Fragment key={id}>
                <tr
                  onClick={() => setOpen(expanded ? null : id)}
                  aria-expanded={expanded}
                  className={cn('cursor-default border-t border-line-subtle hover:bg-hover', expanded && 'bg-hover')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      title={c.title?.(row)}
                      className={cn(
                        'truncate py-2',
                        c.align === 'right' ? 'pl-2 text-right' : 'pr-2',
                        c.cellClass?.(row) ?? 'text-fg-secondary',
                        c.hideBelow && HIDE[c.hideBelow],
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded && (
                  <tr className="bg-hover">
                    {/* colSpan 取全部列数：隐藏的列不占位，多写不影响 */}
                    <td colSpan={columns.length} className="p-0!">
                      <div className="usage-expand overflow-hidden rounded-b-md">
                        <div className="min-w-0 overflow-hidden p-3 pt-1">{detail(row)}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 时间列宽度：表格很窄时只显示「时:分」，日期放到悬停提示和详情里 */
export const TIME_COL_WIDTH = 'w-[7.4em] @max-[460px]:w-[4.2em]'

/** 时间单元格：「10-02 18:24」，表格很窄时只剩「18:24」 */
export function TimeCell({ text }: { text: string }) {
  useI18n()
  const i = text.lastIndexOf(' ')
  if (i < 0) return <>{text}</>
  return (
    <>
      <span className="@max-[460px]:hidden">{text.slice(0, i + 1)}</span>
      {text.slice(i + 1)}
    </>
  )
}

/** 模型单元格：表格很窄时省掉「claude-」前缀（claude-opus-5-5 → opus-5-5），完整名字在悬停提示里 */
export function ModelCell({ model }: { model: string }) {
  useI18n()
  if (!model.startsWith('claude-')) return <>{model}</>
  return (
    <>
      <span className="@max-[460px]:hidden">claude-</span>
      {model.slice('claude-'.length)}
    </>
  )
}

/** 详情卡片：字段网格（窄时两列）+ 底部一行（ID、按钮） */
export function UsageDetailCard({ fields, footer }: { fields: Array<[string, string]>; footer: ReactNode }) {
  useI18n()
  return (
    <div className="@container rounded-md border border-line bg-surface p-3">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-meta @max-[520px]:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="truncate text-fg-muted">{k}</dt>
            <dd className="truncate text-fg tabular-nums" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-line-subtle pt-2.5">{footer}</div>
    </div>
  )
}
