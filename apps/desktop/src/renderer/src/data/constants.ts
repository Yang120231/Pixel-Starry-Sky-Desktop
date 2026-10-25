// 两套数据共用的固定内容（输入框设置），不是用户数据
import type { AppData } from './types'

export const COMPOSER: AppData['composer'] = {
  placeholder: '描述你要做的事，@ 添加文件，/ 输入命令',
  engine: { short: 'Cx', name: 'Codex' },
  effort: 'High',
}
