import {
  Blocks, Bolt, ChartColumn, ChartNoAxesCombined, Cloud, CodeXml, Command, Folder, FolderOpen, FolderPlus,
  Gauge, GitBranch, LayoutDashboard, MessageSquare, PenLine, Plug, Plus, Puzzle, Settings, SlidersHorizontal, SquarePen,
  SquareTerminal, type LucideIcon,
} from 'lucide-react'

/** 可替换图标的侧栏动作 */
export const SIDEBAR_ACTIONS = ['newTask', 'addProject', 'settings', 'plugins', 'usage'] as const
export type SidebarAction = (typeof SIDEBAR_ACTIONS)[number]

/** 原右上角顶栏的工具；图标固定，位置可与侧栏动作互换 */
export const HEADER_ACTIONS = ['terminal', 'editor', 'commandPalette', 'workbench', 'machines', 'channels', 'git'] as const
export type HeaderAction = (typeof HEADER_ACTIONS)[number]

/** 图标位置编辑器里可移动的全部入口 */
export const LAYOUT_ACTIONS = [...SIDEBAR_ACTIONS, ...HEADER_ACTIONS] as const
export type LayoutAction = (typeof LAYOUT_ACTIONS)[number]

const HEADER_ICONS: Record<HeaderAction, LucideIcon> = {
  terminal: SquareTerminal,
  editor: CodeXml,
  commandPalette: Command,
  workbench: LayoutDashboard,
  machines: Cloud,
  channels: MessageSquare,
  git: GitBranch,
}

export function isSidebarAction(action: LayoutAction): action is SidebarAction {
  return (SIDEBAR_ACTIONS as readonly string[]).includes(action)
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
  return isSidebarAction(action) ? getSidebarIcon(action, icons) : HEADER_ICONS[action]
}
