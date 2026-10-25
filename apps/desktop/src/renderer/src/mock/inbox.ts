// 任务 › 待处理 的演示数据（docs/ui/tasks-inbox.md），只在 `pnpm dev:demo` 显示；三栏各一条
import type { InboxItem } from '@/features/panel/inbox/inboxModel'

const now = Date.now()
/** 定时任务开出来的演示会话（照参考图借用已有的会话，看板上显示「⏱ 定时」） */
export const demoScheduledSessions: readonly string[] = ['s-settings-form']
export const demoInbox: InboxItem[] = [
  {
    sessionId: 's-settings-form',
    title: '设置页迁移到新的表单组件',
    project: 'pixel-web',
    lane: 'waiting',
    at: now - 2 * 60_000,
    error: null,
    queue: null,
    signature: 'demo-w',
    request: {
      requestId: 'demo-req',
      itemId: null,
      kind: 'command',
      title: '运行命令',
      command: 'pnpm test --filter settings',
      alwaysScopes: [],
    },
  },
  {
    sessionId: 's-redesign',
    title: '重构网页版工作台为 Codex 式布局',
    project: 'pixel-web',
    lane: 'failed',
    at: now - 18 * 60_000,
    request: null,
    error: '额度不足：当前分组余额为 0，请充值或切换线路后重试',
    queue: null,
    signature: 'demo-f',
  },
  {
    sessionId: 's-cloud-onboarding',
    title: '把云主机配置引导改成两步',
    project: 'pixel-web',
    lane: 'paused',
    at: now - 3 * 3600_000,
    request: null,
    error: null,
    queue: { queued: 2, failed: 0, paused: true },
    signature: 'demo-p',
  },
]
