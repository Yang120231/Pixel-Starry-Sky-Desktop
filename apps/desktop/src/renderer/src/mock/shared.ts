// 两套数据共用的固定内容（导航、面板标签、输入框设置），不是用户数据
import type { AppData, PanelTab, RailItem } from './types'

/** 图标栏 = 全局导航（侧边栏不再重复放导航，见 docs/ui/design-refresh.md §5） */
export const RAIL_ITEMS: RailItem[] = [
  { id: 'workbench', label: '工作台', icon: 'workbench' },
  { id: 'machines', label: '云主机', icon: 'machines' },
  { id: 'channels', label: '协作频道', icon: 'channels' },
  { id: 'skills', label: '技能与插件', icon: 'skills' },
]


export const PANEL_TABS: PanelTab[] = [
  { id: 'files', kind: 'files', label: '文件' },
  { id: 'copies', kind: 'copies', label: '副本' },
  { id: 'sandbox', kind: 'sandbox', label: '环境' },
  { id: 'browser', kind: 'browser', label: '浏览器', closable: true },
  { id: 'tasks', kind: 'tasks', label: '任务清单' },
]

export const COMPOSER: AppData['composer'] = {
  placeholder: '描述你要做的事，@ 添加文件，/ 输入命令',
  engine: { short: 'Cx', name: 'Codex' },
  effort: 'High',
}
