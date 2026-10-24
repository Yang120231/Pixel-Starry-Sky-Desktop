// 提交历史的小部件（docs/ui/git-panel.md §9.3–9.5）：分支线单元格、引用标记、改动文件列表
import { Cloud, FileClock, FileCode2, GitBranch, GitCommitHorizontal, Tag } from 'lucide-react'
import { useState } from 'react'
import { cn, IconButton } from '@/ui'
import { tr } from '@/i18n/core'
import type { GitCommitFile } from '../../../../../shared/types/project-tools'
import type { GraphRow, SyncState } from './graph'
import { SYNC_TITLE_KEY, type Badge, type BadgeKind, type BadgeTone } from './historyModel'
import { splitPath } from './gitModel'
import { GitFileMenu, type GitFileMenuPosition } from './GitFileMenu'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'

/** 一行（不含展开的详情）的高度：两行文字 */
export const ROW_H = 44
/**
 * 车道颜色：当前分支的线按同步状态上色（未推送 / 已推送 / 远程新提交，docs/ui/git-graph-colors.md），
 * 别的分支按车道轮换，轮换的 5 种颜色避开这三种；浅色 / 深色 / 极夜由设计变量（tokens.css --graph-*）切换
 */
const COLORS = [
  'var(--graph-lane-1)',
  'var(--graph-lane-2)',
  'var(--graph-lane-3)',
  'var(--graph-lane-4)',
  'var(--graph-lane-5)',
]
export const laneColor = (i: number): string => COLORS[i % COLORS.length]
export const SYNC_COLOR: Record<SyncState, string> = {
  local: 'var(--graph-local)',
  synced: 'var(--graph-synced)',
  incoming: 'var(--graph-incoming)',
}
/** 有同步状态用状态色，否则按车道 */
export const lineColor = (state: SyncState | undefined, lane: number): string =>
  state ? SYNC_COLOR[state] : laneColor(lane)

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
  title,
}: {
  row: GraphRow
  lanes: number
  node: NodeStyle
  expanded: boolean
  /** 悬停在节点上的提示（同步状态） */
  title?: string
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
            .map(
              l =>
                [
                  l.kind === 'full' ? l.from : l.to,
                  [lineColor(l.state, l.color), l.state === 'incoming'] as const,
                ] as const,
            ),
        ),
      ]
    : []
  const incomingRow = row.state === 'incoming'
  const color = lineColor(row.state, row.color)
  const nx = x(row.lane)
  return (
    <div aria-hidden className="relative shrink-0 self-stretch" style={{ width }}>
      <svg width={width} height={ROW_H} className="absolute top-0 left-0 overflow-visible">
        {row.lines.map((line, i) => (
          <path
            key={i}
            d={path(line)}
            fill="none"
            stroke={lineColor(line.state, line.color)}
            strokeWidth={1.5}
            strokeDasharray={line.state === 'incoming' ? '3 2.5' : undefined}
          />
        ))}
        <g>
          {title && <title>{title}</title>}
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
          ) : incomingRow ? (
            // 远程新提交：空心圈
            <circle cx={nx} cy={cy} r={3.75} fill="var(--bg-surface)" stroke={color} strokeWidth={1.5} />
          ) : (
            // 已推送的实心点略小，未推送的大一点
            <circle cx={nx} cy={cy} r={row.state === 'synced' ? 3 : 3.75} fill={color} />
          )}
        </g>
      </svg>
      {below.map(([col, [c, dashed]]) => (
        <span
          key={col}
          className="absolute bottom-0 w-[1.5px]"
          style={{
            top: ROW_H,
            left: x(col) - 0.75,
            background: dashed ? `repeating-linear-gradient(to bottom, ${c} 0 3px, transparent 3px 5.5px)` : c,
          }}
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

/** 标记跟线同色：边框和文字用状态色，底色是它的淡色 */
const toneStyle = (tone: BadgeTone) =>
  tone === 'neutral'
    ? undefined
    : {
        borderColor: `color-mix(in srgb, ${SYNC_COLOR[tone]} 60%, transparent)`,
        color: SYNC_COLOR[tone],
        background: `color-mix(in srgb, ${SYNC_COLOR[tone]} 12%, transparent)`,
      }

export function RefBadge({ badge, className }: { badge: Badge; className?: string }) {
  return (
    <span
      title={badge.tone === 'neutral' ? badgeTitle(badge) : `${badgeTitle(badge)} · ${tr(SYNC_TITLE_KEY[badge.tone])}`}
      data-ref-kind={badge.kind}
      data-ref-tone={badge.tone}
      style={toneStyle(badge.tone)}
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

/** 一个提交 / 一段比较里改动的文件：状态字母、文件名、目录、+/−；点了看差异，悬停可以打开文件、看这个文件的历史 */
export function ChangedFiles({
  files,
  target,
  root,
  demo,
  onOpen,
  onOpenFile,
  onHistory,
  isCurrent,
}: {
  files: GitCommitFile[]
  target: WorkspaceRef
  root: string
  demo: boolean
  onOpen: (index: number) => void
  /** 打开工作区里这个文件现在的版本；只给 local 不为空的文件显示 */
  onOpenFile?: (index: number) => void
  onHistory?: (index: number) => void
  /** 代码模式下中栏正开着这个文件的对比：高亮这一行 */
  isCurrent?: (file: GitCommitFile) => boolean
}) {
  const [menu, setMenu] = useState<(GitFileMenuPosition & { path: string }) | null>(null)
  const menuIndex = menu ? files.findIndex(f => f.path === menu.path) : -1
  const menuFile = files[menuIndex]
  return (
    <ul className="flex flex-col">
      {files.map((file, i) => {
        const { name, dir } = splitPath(file.path)
        return (
          <li
            key={file.path}
            data-git-history-file={file.path}
            onContextMenu={e => {
              e.preventDefault()
              e.stopPropagation()
              const trigger = e.currentTarget.querySelector('button')!
              trigger.focus({ preventScroll: true })
              setMenu({ x: e.clientX, y: e.clientY, trigger, path: file.path })
            }}
            onKeyDown={e => {
              if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
              e.preventDefault()
              e.stopPropagation()
              const trigger = e.currentTarget.querySelector('button')!
              const rect = trigger.getBoundingClientRect()
              setMenu({ x: rect.left + 20, y: rect.bottom, trigger, path: file.path })
            }}
            className={cn(
              'group/file flex min-w-0 items-center rounded-md hover:bg-hover',
              isCurrent?.(file) && 'bg-selected',
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(i)}
              title={`${tr('git.viewDiff')} · ${file.origPath ? file.origPath + ' → ' : ''}${file.path}`}
              className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left"
            >
              <span
                className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', CODE_COLOR[file.code])}
              >
                {file.code}
              </span>
              <span
                className={cn(
                  // 窄侧栏里悬停出两个按钮时，文件名可以截短，不压到右边的 +/−
                  'min-w-0 truncate text-list',
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
            {onOpenFile && file.local && (
              <span className="shrink-0 opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100">
                <IconButton
                  icon={FileCode2}
                  label={tr('git.open')}
                  size={22}
                  iconSize={12}
                  onClick={() => onOpenFile(i)}
                />
              </span>
            )}
            {onHistory && file.code !== 'D' && (
              <span className="shrink-0 opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100">
                <IconButton
                  icon={FileClock}
                  label={tr('git.history.file.show')}
                  size={22}
                  iconSize={12}
                  onClick={() => onHistory(i)}
                />
              </span>
            )}
          </li>
        )
      })}
      {menu && menuFile && (
        <GitFileMenu
          file={menuFile}
          target={target}
          root={root}
          demo={demo}
          position={menu}
          onDiff={() => onOpen(menuIndex)}
          onOpen={onOpenFile && menuFile.local ? () => onOpenFile(menuIndex) : undefined}
          onHistory={onHistory ? () => onHistory(menuIndex) : undefined}
          onClose={() => {
            setMenu(null)
            menu.trigger.focus({ preventScroll: true })
          }}
        />
      )}
    </ul>
  )
}
