import {
  Blocks,
  Bolt,
  ChartColumn,
  ChartNoAxesCombined,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  SquareArrowOutUpRight,
  PenLine,
  Plug,
  Plus,
  Puzzle,
  Settings,
  SlidersHorizontal,
  SquarePen,
  type LucideIcon,
} from 'lucide-react'

/** 可替换图标的侧栏动作 */
export const SIDEBAR_ACTIONS = ['newTask', 'addProject', 'settings', 'plugins', 'usage'] as const
export type SidebarAction = (typeof SIDEBAR_ACTIONS)[number]

/** 能放在侧栏底部的动作（可换图标）；新建任务、添加项目固定在侧栏里，只能换图标（docs/ui/layout-v2.md §7.1） */
export const FOOTER_ACTIONS = ['settings', 'plugins', 'usage'] as const
export type FooterAction = (typeof FOOTER_ACTIONS)[number]

/**
 * 原右上角顶栏的工具；图标固定，位置可与底部动作互换。
 * 终端、编辑器（</>）、命令面板已于 2026-10-10 移除（D066）：终端和文件在右侧工作区，命令面板用 Ctrl+Shift+P；
 * 云主机 2026-10-13 并进顶栏的机器切换；工作台、频道同日不再是顶栏按钮，频道在侧栏第四行（docs/ui/layout-v2.md）。
 * 保存的布局里如果还有它们，读取时自动丢弃。
 */
export const HEADER_ACTIONS = ['git', 'openIn'] as const
export type HeaderAction = (typeof HEADER_ACTIONS)[number]

/** 图标位置编辑器里可移动的全部入口 */
export const LAYOUT_ACTIONS = [...FOOTER_ACTIONS, ...HEADER_ACTIONS] as const
export type LayoutAction = (typeof LAYOUT_ACTIONS)[number]

const HEADER_ICONS: Record<HeaderAction, LucideIcon> = {
  git: GitBranch,
  openIn: SquareArrowOutUpRight,
}

export function isFooterAction(action: LayoutAction): action is FooterAction {
  return (FOOTER_ACTIONS as readonly string[]).includes(action)
}

/** 显式引用候选图标；本机偏好只保存 ID，不保存组件或导入整个图标库。 */
const ICONS = {
  'square-pen': SquarePen,
  'pen-line': PenLine,
  plus: Plus,
  'folder-plus': FolderPlus,
  'folder-open': FolderOpen,
  folder: Folder,
  settings: Settings,
  'sliders-horizontal': SlidersHorizontal,
  bolt: Bolt,
  puzzle: Puzzle,
  blocks: Blocks,
  plug: Plug,
  'chart-column': ChartColumn,
  'chart-no-axes-combined': ChartNoAxesCombined,
  gauge: Gauge,
} satisfies Record<string, LucideIcon>

export type SidebarIconId = keyof typeof ICONS
export type SidebarIcons = Record<SidebarAction, SidebarIconId>

export const SIDEBAR_ICON_OPTIONS: Record<SidebarAction, readonly SidebarIconId[]> = {
  newTask: ['square-pen', 'pen-line', 'plus'],
  addProject: ['folder-plus', 'folder-open', 'folder'],
  settings: ['settings', 'sliders-horizontal', 'bolt'],
  plugins: ['puzzle', 'blocks', 'plug'],
  usage: ['chart-column', 'chart-no-axes-combined', 'gauge'],
}

export const DEFAULT_SIDEBAR_ICONS: SidebarIcons = {
  newTask: 'square-pen',
  addProject: 'folder-plus',
  settings: 'settings',
  plugins: 'puzzle',
  usage: 'chart-column',
}

export function isSidebarIcon(action: SidebarAction, value: unknown): value is SidebarIconId {
  return typeof value === 'string' && SIDEBAR_ICON_OPTIONS[action].includes(value as SidebarIconId)
}

export function getSidebarIcon(action: SidebarAction, icons: SidebarIcons): LucideIcon {
  const id = isSidebarIcon(action, icons[action]) ? icons[action] : DEFAULT_SIDEBAR_ICONS[action]
  return ICONS[id]
}

/** 任意入口的当前图标：侧栏动作按用户选择，顶栏工具固定 */
export function getLayoutIcon(action: LayoutAction, icons: SidebarIcons): LucideIcon {
  return isFooterAction(action) ? getSidebarIcon(action, icons) : HEADER_ICONS[action]
}
