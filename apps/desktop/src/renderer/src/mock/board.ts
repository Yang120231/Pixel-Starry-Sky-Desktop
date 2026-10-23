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
    // 事项（docs/ui/channels-collab-v2.md §9）：交给频道成员在做的、做完等验收的
    task('b-form', 'pixel-web', '设置页迁移到新的表单组件', {
      status: 'in_progress',
      tags: ['界面'],
      assignee: { channelId: 'c-web', memberId: 'a-frontend', name: '前端助手' },
      acceptance: [
        { text: '所有设置项都用新的表单组件', done: false },
        { text: '键盘能走完整个表单', done: false },
      ],
      link: { channelId: 'c-web', taskId: 'web-t2', state: 'running', round: 1, checks: null, at: now - 600_000 },
    }),
    task('b-login', 'pixel-web', '登录页错误提示改成内联', {
      status: 'review',
      tags: ['界面'],
      note: '密码错误、网络错误都显示在输入框下面',
      assignee: { channelId: 'c-web', memberId: 'a-frontend', name: '前端助手' },
      acceptance: [
        { text: '密码错误显示在密码框下面', done: true },
        { text: '网络错误能重试', done: false },
        { text: '屏幕阅读器能读到错误', done: false },
      ],
      link: {
        channelId: 'c-web',
        taskId: 'web-t1',
        state: 'done',
        round: 1,
        checks: { status: 'fail', problems: 2 },
        at: now - 1_800_000,
      },
    }),
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
