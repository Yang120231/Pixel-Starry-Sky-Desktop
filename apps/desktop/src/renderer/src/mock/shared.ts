// 两套数据共用的固定内容（导航、输入框设置），不是用户数据
import type { AppData, RailItem } from './types'

/** 图标栏 = 全局导航（侧边栏不再重复放导航，见 docs/ui/design-refresh.md §5） */
export const RAIL_ITEMS: RailItem[] = [
  { id: 'workbench', label: '工作台', icon: 'workbench' },
  { id: 'machines', label: '云主机', icon: 'machines' },
  { id: 'channels', label: '协作频道', icon: 'channels' },
  { id: 'skills', label: '技能与插件', icon: 'skills' },
]


export const COMPOSER: AppData['composer'] = {
  placeholder: '描述你要做的事，@ 添加文件，/ 输入命令',
  engine: { short: 'Cx', name: 'Codex' },
  effort: 'High',
}
