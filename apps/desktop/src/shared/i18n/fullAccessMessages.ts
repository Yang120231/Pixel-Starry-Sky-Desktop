// 完全放行的二次确认（docs/ui/full-access-confirm.md）
export const fullAccessMessages = {
  'fullAccess.confirm.title': { zh: '这个对话完全放行？', en: 'Give this conversation full access?' },
  'fullAccess.confirm.newTitle': { zh: '这个任务完全放行？', en: 'Give this task full access?' },
  'fullAccess.confirm.noAsk': {
    zh: '运行命令、改文件、删文件都不再问你',
    en: 'Commands, edits and deletions all run without asking',
  },
  'fullAccess.confirm.claude': {
    zh: 'Claude Code 会跳过所有权限检查',
    en: 'Claude Code skips every permission check',
  },
  'fullAccess.confirm.codex': {
    zh: 'Codex 会关掉沙箱，能读写整台电脑、联网',
    en: 'Codex turns off its sandbox and can read, write and use the network anywhere',
  },
  'fullAccess.confirm.pixel': {
    zh: '像素星空 agent 会跳过所有权限检查',
    en: 'The PixelSky agent skips every permission check',
  },
  'fullAccess.confirm.scope': {
    zh: '只管这个对话，新任务还是「{p0}」',
    en: 'Only this conversation; new tasks still use "{p0}"',
  },
  'fullAccess.confirm.scopeNew': {
    zh: '只管这个任务，以后的新任务还是「{p0}」',
    en: 'Only this task; later new tasks still use "{p0}"',
  },
  'fullAccess.confirm.dontAsk': { zh: '以后不再提醒', en: "Don't ask again" },
  'fullAccess.confirm.cancel': { zh: '取消', en: 'Cancel' },
  'fullAccess.confirm.ok': { zh: '完全放行', en: 'Allow everything' },

  'fullAccess.strip': {
    zh: '这个对话完全放行：命令、改文件、删文件都不再问你',
    en: 'Full access: commands, edits and deletions run without asking',
  },
  'fullAccess.stripNew': {
    zh: '这个任务完全放行：命令、改文件、删文件都不再问你',
    en: 'Full access for this task: commands, edits and deletions run without asking',
  },
  'fullAccess.revert': { zh: '改回{p0}', en: 'Switch to {p0}' },
  'fullAccess.dismissStrip': { zh: '不再提示', en: 'Dismiss' },

  'fullAccess.default.title': { zh: '以后的新任务都完全放行？', en: 'Start every new task with full access?' },
  'fullAccess.default.body': {
    zh: '{p0} 的新任务一开始就不问你：运行命令、改文件、删文件都直接做。',
    en: 'New {p0} tasks start without asking: commands, edits and deletions just run.',
  },
  'fullAccess.default.note': {
    zh: '已经开始的对话不变。随时可以在这里改回来。',
    en: "Conversations already started don't change. You can switch back here anytime.",
  },
  'fullAccess.default.ok': { zh: '新任务默认完全放行', en: 'Default to full access' },

  'fullAccess.setting.title': { zh: '切到完全放行前先确认', en: 'Confirm before full access' },
  'fullAccess.setting.desc': {
    zh: '在输入框的权限菜单里选「完全放行」时，先说明会发生什么再切换',
    en: 'Explain what happens before switching to full access from the permission menu',
  },
  'fullAccess.setting.keywords': {
    zh: '完全放行 权限 确认 提醒 不再提醒 危险 full access permission confirm bypass',
    en: 'full access permission confirm bypass dangerous ask again',
  },
} as const
