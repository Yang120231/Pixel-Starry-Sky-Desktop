// 演示数据：照参考图 docs/reference/workbench-session.jpg 写的，品牌名已替换。
// 用 `pnpm dev:demo` 启动时显示，用来对照参考图调样式。
import type { AppData } from '@/data/types'
import { COMPOSER, RAIL_ITEMS } from '@/data/constants'
import { demoChannelMembers, demoChannelMessages, demoChannels } from './channels'
import { SHOWCASE_PROJECT, SHOWCASE_SESSIONS, showcaseSnapshots } from './conversations'

export const demo: AppData = {
  currentUser: { name: '林夏' },
  railItems: RAIL_ITEMS,
  pinned: [
    { id: 'board', kind: 'board', title: '任务看板', meta: '7 项进行中', trailing: '3 等你' },
    { id: 's-redesign-pinned', kind: 'session', title: '重构网页版工作台为 Codex 式布局', unread: true },
  ],
  projects: [
    {
      id: 'pixel-web',
      name: 'pixel-web',
      running: true,
      expanded: true,
      sessions: [
        { id: 's-hhh', title: 'hhh', status: 'idle', time: '刚刚' },
        { id: 's-redesign', title: '重构网页版工作台为 Codex 式布局', status: 'unread' },
        { id: 's-settings-form', title: '设置页迁移到新的表单组件', status: 'running' },
        { id: 's-cloud-onboarding', title: '把云主机配置引导改成两步', status: 'idle', time: '3天' },
      ],
      archived: [{ id: 's-archived-demo', title: '已完成的项目检查', status: 'idle', time: '5天', archivedAt: 1 }],
    },
    // 对话展示：用真实对话组件显示（docs/ui/demo-conversation.md）
    {
      id: SHOWCASE_PROJECT,
      name: '对话展示（Claude）',
      expanded: true,
      sessions: SHOWCASE_SESSIONS.map(s => ({
        id: s.id,
        title: s.title,
        status: showcaseSnapshots[s.id].state === 'idle' ? ('idle' as const) : ('running' as const),
      })),
    },
    { id: 'pixel-desktop', name: 'pixel-desktop', branch: 'feat/turn-island', sessions: [] },
    { id: 'pixel-channel', name: 'pixel-channel', sessions: [] },
    { id: 'docs-site', name: 'docs-site', sessions: [] },
    { id: 'research-notes', name: 'research-notes', sessions: [] },
  ],
  recent: [
    { id: 's-hhh', title: 'hhh', project: 'pixel-web', time: '刚刚' },
    { id: 'r-cloud-reconnect', title: '修复云主机断线后仍显示已连接', time: '刚刚' },
    { id: 'r-channel-quote', title: '频道话题支持引用回复', project: 'pixel-channel', time: '1时', hasPr: true },
    { id: 'r-changelog', title: '整理 10 月更新日志', project: 'docs-site', time: '3时' },
  ],
  runStatus: { running: 2, newReplies: 1 },
  defaultSessionId: 's-hhh',
  sessionDiff: { added: 42, removed: 10 },
  toolCalls: [
    { kind: 'edit', path: 'src/styles/session.css', added: 15, removed: 2 },
    { kind: 'run', command: 'npm run build', ok: true, duration: '2.2s' },
  ],
  assistantReply: {
    intro: '好的，已按你的要求处理：',
    bullets: [
      { text: '先读了相关文件，确认改动范围只在当前工作区；' },
      { text: '改完后跑了一遍构建，', bold: '没有新的告警', after: '；' },
      { text: '浏览器里打开检查过，桌面和窄屏都正常。' },
    ],
    outro: '如果要我继续，可以直接说下一步，或者把这条设为定时任务。',
  },
  changedFiles: {
    added: 42,
    removed: 10,
    files: [
      { dir: 'src/session/', name: 'Composer.jsx', added: 27, removed: 8 },
      { dir: 'src/styles/', name: 'session.css', added: 15, removed: 2 },
    ],
  },
  turnUsage: {
    durationMs: 44_000,
    models: {
      'claude-opus-5-5': {
        input: 1200,
        cacheRead: 48_000,
        cacheWrite: 2900,
        output: 2100,
        costUsd: 0.0743,
        requests: 7,
      },
      'claude-haiku-4-5': { input: 600, cacheRead: 9000, cacheWrite: 0, output: 380, costUsd: 0.0034, requests: 2 },
    },
  },
  attachments: [
    { id: 'a-chrome', kind: 'browser', label: 'Chrome · 127.0.0.1:8330' },
    { id: 'a-shot', kind: 'screenshot', label: '截图 10-42.png' },
    { id: 'a-doc', kind: 'file', label: '需求说明.md' },
    { id: 'a-minimal', kind: 'mode', label: '极简模式' },
  ],
  composer: { ...COMPOSER, placeholder: '继续追问或提出修改，@ 添加文件，/ 输入命令' },
  composerStatus: { machine: '这台电脑', branch: 'main', contextPercent: 12 },
  defaultPanelOpen: true,
  browserPages: [
    { id: 'p-web', kind: 'site', title: 'pixel-web' },
    { id: 'p-learn', kind: 'site', title: 'Features | Learn' },
    { id: 'p-preview', kind: 'preview', title: '预览 · workbench-1440.png' },
  ],
  browserUrl: '127.0.0.1:8330/',
  annotations: [{ id: 1, text: '侧栏分组标题再淡一点' }],
  billing: {
    priceCurrency: 'CNY',
    rate: 7,
    plans: [
      {
        id: 'basic-month',
        name: '基础月卡',
        price: 29,
        period: 'month',
        quotas: { daily: 3, monthly: 45 },
        features: ['适合偶尔使用', '支持 Claude、Codex 引擎'],
      },
      {
        id: 'pro-month',
        name: 'Pro 月卡',
        price: 99,
        period: 'month',
        quotas: { daily: 10, weekly: 50, monthly: 150 },
        features: ['适合日常开发', '支持 Claude、Codex 引擎', '优先排队'],
        recommended: true,
      },
      {
        id: 'max-month',
        name: 'Max 月卡',
        price: 299,
        period: 'month',
        quotas: { daily: 40, weekly: 200, monthly: 600 },
        features: ['适合多会话并行', '支持 Claude、Codex 引擎', '优先排队', '更高并发'],
      },
    ],
    planNote: '订阅按月计费，到期前可续费；更换套餐后立即生效，剩余天数按比例折算。',
    topUpOptions: [{ credit: 10 }, { credit: 20 }, { credit: 50, bonus: 2 }, { credit: 100, bonus: 5 }],
    customTopUp: { min: 5, max: 1000 },
    paymentMethods: [
      { id: 'alipay', label: '支付宝' },
      { id: 'wechat', label: '微信支付' },
    ],
    topUpNote: '充值额度不会过期，订阅额度用完后从余额扣除。',
  },
  // 协作频道的角标由未读数计算（features/channels/store.ts），不再写在 BADGES 里
  channels: demoChannels,
  channelMembers: demoChannelMembers,
  channelMessages: demoChannelMessages,
}
