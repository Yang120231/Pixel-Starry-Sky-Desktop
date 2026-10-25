// 任务看板的演示任务（docs/ui/task-board.md §7）：分在几个演示项目里，各列都有，含过期、高优先级、固定、
// 最近 7 天和更早完成的。只在 `pnpm dev:demo` 显示，改动只在本次运行内有效。
import type { ManualTask, ScheduleRun, TaskSchedule } from '../../../shared/types/project-tools'

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
  const at = (daysAgo: number, h: number, m = 0): number => {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }
  const run = (when: number, status: ScheduleRun['status'], patch: Partial<ScheduleRun> = {}): ScheduleRun => ({
    at: when,
    trigger: 'schedule',
    status,
    endedAt: status === 'running' || status === 'missed' || status === 'skipped' ? null : when + 240_000,
    ...patch,
  })
  const schedule = (patch: Partial<TaskSchedule>): TaskSchedule => ({
    enabled: true,
    freq: 'daily',
    hour: 9,
    minute: 0,
    weekday: 1,
    engine: 'claude',
    model: null,
    permission: 'plan',
    session: 'new',
    lastSlot: 0,
    runs: [],
    ...patch,
  })
  return [
    // 定时任务（docs/ui/board-schedule.md）：每日依赖更新检查刚跑完；晚上的测试正在跑；周报暂停着
    task('b-sch-deps', 'pixel-web', '每日依赖更新检查', {
      note: '检查 package.json 里有没有可以升级的依赖，只列出来，不要改文件。有安全补丁的放最前面，说明影响范围。',
      schedule: schedule({
        runs: [
          run(at(0, 9), 'done', { sessionId: 's-settings-form', note: '3 个依赖可升级，1 个安全补丁' }),
          run(at(1, 9), 'done', { sessionId: 's-redesign', note: '没有可升级的依赖' }),
          run(at(2, 9), 'missed'),
          run(at(3, 9), 'failed', { sessionId: 's-redesign', note: '额度用完', endedAt: at(3, 9) + 60_000 }),
          run(at(4, 15, 12), 'done', { trigger: 'manual', sessionId: 's-redesign', endedAt: at(4, 15, 12) + 300_000 }),
        ],
      }),
    }),
    task('b-sch-tests', 'pixel-server', '每晚跑测试并总结失败', {
      note: '运行项目的测试，把失败的用例按原因归类总结。不要修改文件。',
      schedule: schedule({
        freq: 'weekdays',
        hour: 22,
        minute: 30,
        runs: [run(now - 6 * 60_000, 'running', { sessionId: 's-settings-form' })],
      }),
    }),
    task('b-sch-git', 'pixel-desktop', '每周汇总 git 提交', {
      note: '汇总过去一周的 git 提交，按主题归类，写成一份简短的周报。不要修改文件。',
      schedule: schedule({
        enabled: false,
        freq: 'weekly',
        hour: 10,
        runs: [run(at(7, 10), 'failed', { note: '额度用完', endedAt: at(7, 10) + 60_000 })],
      }),
    }),
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
