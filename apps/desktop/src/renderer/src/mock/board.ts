// 任务看板的演示任务（docs/ui/task-board.md §7）：分在几个演示项目里，各列都有，含过期、高优先级、固定、
// 最近 7 天和更早完成的。只在 `pnpm dev:demo` 显示，改动只在本次运行内有效。
import type { ManualTask } from '../../../shared/types/project-tools'

const DAY = 86_400_000
const date = (at: number): string => new Date(at).toISOString().slice(0, 10)

export function demoBoardTasks(now: number): ManualTask[] {
  let order = 0
  const task = (
    id: string,
    projectId: string,
    title: string,
    patch: Partial<ManualTask> & { ago?: number } = {},
  ): ManualTask => {
    const { ago = 1, ...rest } = patch
    return {
      id,
      projectId,
      title,
      note: '',
      status: 'pending',
      priority: 'normal',
      due: '',
      tags: [],
      order: order++,
      createdAt: now - ago * DAY,
      updatedAt: now - ago * DAY,
      completedAt: null,
      pinnedAt: null,
      ...rest,
    }
  }
  return [
    task('b-spacing', 'pixel-web', '设置页的间距统一成 8 的倍数', {
      priority: 'high',
      due: date(now - 2 * DAY),
      tags: ['设计'],
      note: '参考新的设计稿，表单行间距 16，分组之间 24',
    }),
    task('b-readme', 'docs-site', '更新 README 里草稿功能那一节', { due: date(now + 3 * DAY), tags: ['文档'] }),
    task('b-shortcut', 'pixel-desktop', '整理快捷键列表，补上窗格相关的', { priority: 'low' }),
    task('b-onboarding', 'pixel-web', '云主机引导改成两步：选机器、确认', {
      status: 'in_progress',
      priority: 'high',
      due: date(now + 1 * DAY),
      pinnedAt: now - DAY,
    }),
    task('b-island', 'pixel-desktop', '轮次跳转条在窄窗口下改成悬浮', { status: 'in_progress', tags: ['界面'] }),
    task('b-draft', 'pixel-web', '草稿按会话保存，切换不丢', {
      status: 'completed',
      completedAt: now - 2 * 3_600_000,
      ago: 2,
    }),
    task('b-quote', 'pixel-channel', '频道话题支持引用回复', {
      status: 'completed',
      completedAt: now - 3 * DAY,
      ago: 4,
    }),
    task('b-changelog', 'docs-site', '整理 10 月更新日志', {
      status: 'completed',
      completedAt: now - 12 * DAY,
      ago: 14,
    }),
    task('b-icons', 'pixel-desktop', '托盘图标换成新版', { status: 'completed', completedAt: now - 20 * DAY, ago: 21 }),
  ]
}
