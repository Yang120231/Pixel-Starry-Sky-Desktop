// 停止主智能体时连同后台子智能体一起停（docs/ui/subagent-stop.md）
export const subagentStopMessages = {
  'subagentStop.stopTooltip': {
    zh: '停止（Esc）· 连同 {n} 个后台子智能体',
    en: 'Stop (Esc) · along with {n} background subagents',
  },
  'subagentStop.stopOne': { zh: '停止这个子智能体', en: 'Stop this subagent' },
  'subagentStop.stopAll': { zh: '全部停止', en: 'Stop all' },
  'subagentStop.stoppedCount': { zh: '{n} 个已停止', en: '{n} stopped' },
  'subagentStop.keptStrip': {
    zh: '还有 {n} 个后台子智能体在跑',
    en: '{n} background subagents still running',
  },
  'subagentStop.view': { zh: '查看', en: 'View' },
  'subagentStop.setting': {
    zh: '停止时一起停掉后台子智能体',
    en: 'Stop background subagents when stopping',
  },
  'subagentStop.settingHint': {
    zh: '按「停止」中断主智能体时，它在后台派出去的子智能体、多智能体编排也一起停。关掉后它们继续跑，可以在进度卡片里单独停。',
    en: 'When you press Stop to interrupt the main agent, the subagents and multi-agent workflows it started in the background stop too. Turn it off to let them keep running; you can stop them one by one in the progress card.',
  },
  'subagentStop.searchKeywords': {
    zh: '停止 后台 子智能体 编排 中断 保留 stop background subagent workflow interrupt keep',
    en: 'stop background subagent workflow interrupt keep 停止 后台 子智能体 编排 中断 保留',
  },
} as const
