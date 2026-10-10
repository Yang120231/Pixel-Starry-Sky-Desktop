// 新任务的起点（docs/ui/workbench-ux-3.md §2.2）：输入框为空、选好了项目时显示在欢迎页，点了把一段话填进输入框
import { tr } from '@/i18n/core'

export interface Starter {
  id: 'changes' | 'explain' | 'tests'
  label: string
  prompt: string
}

/** changed：项目里有改动的文件数（读不到 Git 状态时为 0） */
export function starters(changed: number): Starter[] {
  const list: Starter[] = [
    {
      id: 'explain',
      label: tr('session.WelcomeView.explainProject'),
      prompt: tr('session.WelcomeView.explainProjectPrompt'),
    },
    { id: 'tests', label: tr('session.WelcomeView.runTests'), prompt: tr('session.WelcomeView.runTestsPrompt') },
  ]
  if (changed > 0)
    list.unshift({
      id: 'changes',
      label: tr('session.WelcomeView.reviewChanges', { n: changed }),
      prompt: tr('session.WelcomeView.reviewChangesPrompt'),
    })
  return list
}
