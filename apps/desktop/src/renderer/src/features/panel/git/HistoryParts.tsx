// 提交历史的小部件（docs/ui/git-panel.md §9.3–9.5）：分支线单元格、引用标记、改动文件列表
import { Cloud, GitBranch, GitCommitHorizontal, Tag } from 'lucide-react'
import { cn } from '@/ui'
import { tr } from '@/i18n/core'
import type { GitCommitFile } from '../../../../../shared/types/project-tools'
import type { GraphRow } from './graph'
import type { Badge, BadgeKind } from './historyModel'
import { splitPath } from './gitModel'

/** 一行（不含展开的详情）的高度：两行文字 */
export const ROW_H = 44
/** 5 种车道颜色（参照 VS Code），浅色 / 深色由设计变量切换 */
const COLORS = ['var(--accent)', 'var(--chart-cache)', 'var(--chart-output)', 'var(--chart-input)', 'var(--ultracode)']
export const laneColor = (i: number): string => COLORS[i % COLORS.length]

/** 车道多时收窄间距，不撑开面板 */
export function laneWidth(lanes: number): number {
  return lanes <= 8 ? 12 : Math.max(5, Math.floor(100 / lanes))
}

export type NodeStyle = 'commit' | 'head' | 'merge' | 'special'

/**
 * 一行的分支线：svg 画本行的连线和节点；展开详情时，继续往下的车道用竖条一直画到详情底部。
 * width 是整列的车道数（所有行取最大，文字对齐）。
 */
export function GraphCell({
  row,
  lanes,
  node,
  expanded,
}: {
  row: GraphRow
  lanes: number
  node: NodeStyle
  expanded: boolean
}) {
  const lane = laneWidth(lanes)
  const width = lanes * lane + 6
  const x = (i: number) => 3 + i * lane + lane / 2
  const cy = ROW_H / 2
  const path = (line: GraphRow['lines'][number]): string => {
    const [x1, x2] = [x(line.from), x(line.to)]
    if (line.kind === 'full') return `M${x1} 0V${ROW_H}`
    const [y1, y2] = line.kind === 'top' ? [0, cy] : [cy, ROW_H]
    if (x1 === x2) return `M${x1} ${y1}V${y2}`
    const mid = (y1 + y2) / 2
    return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
  }
  // 展开时继续往下的车道：本行之后还在等提交的列
  const below = expanded
    ? [
        ...new Map(
          row.lines
            .filter(l => l.kind === 'full' || l.kind === 'bottom')
            .map(l => [l.kind === 'full' ? l.from : l.to, l.color] as const),
        ),
      ]
    : []
  const color = laneColor(row.color)
  const nx = x(row.lane)
  return (
    <div aria-hidden className="relative shrink-0 self-stretch" style={{ width }}>
      <svg width={width} height={ROW_H} className="absolute top-0 left-0 overflow-visible">
        {row.lines.map((line, i) => (
          <path key={i} d={path(line)} fill="none" stroke={laneColor(line.color)} strokeWidth={1.5} />
        ))}
        {node === 'head' ? (
          <>
            <circle cx={nx} cy={cy} r={5.5} fill="var(--bg-surface)" stroke={color} strokeWidth={1.5} />
            <circle cx={nx} cy={cy} r={2.75} fill={color} />
          </>
        ) : node === 'merge' ? (
          <circle cx={nx} cy={cy} r={3.75} fill="var(--bg-surface)" stroke={color} strokeWidth={1.5} />
        ) : node === 'special' ? (
          <circle
            cx={nx}
            cy={cy}
            r={4.5}
            fill="var(--bg-surface)"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="2.2 1.8"
          />
        ) : (
          <circle cx={nx} cy={cy} r={3.75} fill={color} />
        )}
      </svg>
      {below.map(([col, c]) => (
        <span
          key={col}
          className="absolute bottom-0 w-[1.5px]"
          style={{ top: ROW_H, left: x(col) - 0.75, background: laneColor(c) }}
        />
      ))}
    </div>
  )
}

const BADGE_STYLE: Record<BadgeKind, string> = {
  current: 'border-accent-line bg-accent-soft text-accent-fg',
  head: 'border-accent-line bg-accent-soft text-accent-fg',
  base: 'border-warn/45 text-warn',
  branch: 'border-line text-fg-secondary',
  both: 'border-line text-fg-secondary',
  remote: 'border-line text-fg-muted',
  tag: 'border-line text-fg-muted',
}

const badgeTitle = (b: Badge): string =>
  b.kind === 'current'
    ? `${tr('git.history.ref.head')} · ${b.name}`
    : b.kind === 'remote'
      ? `${tr('git.history.ref.remote')} · ${b.name}`
      : b.kind === 'both'
        ? `${tr('git.history.ref.both')} · ${b.name}`
        : b.kind === 'tag'
          ? `${tr('git.history.ref.tag')} · ${b.name}`
          : b.kind === 'base'
            ? `${tr('git.history.ref.base')} · ${b.name}`
            : b.name

function BadgeIcon({ kind }: { kind: BadgeKind }) {
  if (kind === 'tag') return <Tag size={10} className="shrink-0" />
  if (kind === 'remote') return <Cloud size={10} className="shrink-0" />
  if (kind === 'head') return <GitCommitHorizontal size={10} className="shrink-0" />
  return (
    <>
      <GitBranch size={10} className="shrink-0" />
      {kind === 'both' && <Cloud size={10} className="-ml-0.5 shrink-0" />}
    </>
  )
}

export function RefBadge({ badge, className }: { badge: Badge; className?: string }) {
  return (
    <span
      title={badgeTitle(badge)}
      data-ref-kind={badge.kind}
      className={cn(
        'inline-flex h-[18px] min-w-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium',
        BADGE_STYLE[badge.kind],
        className,
      )}
    >
      <BadgeIcon kind={badge.kind} />
      <span className="min-w-0 truncate">{badge.name}</span>
    </span>
  )
}

/** 行尾的引用标记：一行放不下时第一个写名字，其余合成「+N」，悬停列出全部 */
export function RefBadges({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null
  const [first, ...rest] = badges
  return (
    <span className="flex max-w-[55%] min-w-0 shrink-0 items-center gap-1">
      <RefBadge badge={first} />
      {rest.length > 0 && (
        <span
          title={rest.map(badgeTitle).join('\n')}
          className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-line px-1.5 text-[11px] leading-none text-fg-muted tabular-nums"
        >
          +{rest.length}
        </span>
      )}
    </span>
  )
}

const CODE_COLOR: Record<GitCommitFile['code'], string> = {
  A: 'text-success',
  D: 'text-danger',
  M: 'text-warn',
  R: 'text-accent-fg',
  C: 'text-accent-fg',
  T: 'text-warn',
}

/** 一个提交 / 一段比较里改动的文件：状态字母、文件名、目录、+/−；点了看差异 */
export function ChangedFiles({ files, onOpen }: { files: GitCommitFile[]; onOpen: (index: number) => void }) {
  return (
    <ul className="flex flex-col">
      {files.map((file, i) => {
        const { name, dir } = splitPath(file.path)
        return (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => onOpen(i)}
              title={`${tr('git.viewDiff')} · ${file.origPath ? file.origPath + ' → ' : ''}${file.path}`}
              className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover"
            >
              <span
                className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', CODE_COLOR[file.code])}
              >
                {file.code}
              </span>
              <span
                className={cn(
                  'shrink-0 truncate text-list',
                  file.code === 'D' ? 'text-fg-muted line-through' : 'text-fg',
                )}
              >
                {name}
              </span>
              <span className="min-w-0 flex-1 truncate text-meta text-fg-faint">
                {file.origPath ? `${splitPath(file.origPath).name} → ` : ''}
                {dir}
              </span>
              {file.insertions !== null && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  <span className="text-success">+{file.insertions}</span>{' '}
                  <span className="text-danger">−{file.deletions}</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
