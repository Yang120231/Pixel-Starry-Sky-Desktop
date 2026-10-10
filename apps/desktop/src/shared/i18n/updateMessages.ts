// 自动更新（docs/release-update.md §7）
export const updateMessages = {
  'update.group': { zh: '更新', en: 'Updates' },
  'update.checking': { zh: '正在检查…', en: 'Checking…' },
  'update.latest': { zh: '已是最新版本', en: "You're up to date" },
  'update.downloading': { zh: '正在下载 {p0}%', en: 'Downloading {p0}%' },
  'update.restart': { zh: '重启以更新', en: 'Restart to update' },
  'update.download': { zh: '去下载', en: 'Download' },
  'update.unsupported': { zh: '开发模式不检查更新', en: 'Updates are off in development mode' },
  'update.readyTitle': { zh: '新版本 {p0} 已下载好', en: 'Version {p0} is ready' },
  'update.availableTitle': { zh: '有新版本 {p0}', en: 'Version {p0} is available' },
  'update.downloadingTitle': { zh: '正在下载新版本 {p0}', en: 'Downloading version {p0}' },
  'update.readyHint': {
    zh: '重启后自动安装；不重启的话，下次退出时安装',
    en: "Restart to install it now, or it'll install the next time you quit",
  },
  'update.portableHint': {
    zh: '便携版不能自动更新，下载新版本替换现在的 exe 即可',
    en: "The portable version can't update itself. Download the new version and replace this exe",
  },
  'update.downloadingHint': { zh: '下载完成后会提示重启', en: "You'll be asked to restart when it's done" },
  'update.notes': { zh: '更新说明', en: "What's new" },
  'update.error': { zh: '检查更新失败：{p0}', en: 'Update check failed: {p0}' },
  'update.beta': { zh: '接收测试版', en: 'Get beta versions' },
  'update.betaHint': {
    zh: '测试版先拿到新功能，问题也可能更多；关掉后只接收正式版',
    en: 'Betas get new features first but may have more issues. Turn off to get stable releases only',
  },
  'update.later': { zh: '稍后', en: 'Later' },
  // 主进程报的错（translateMessage 按原文翻译）
  'update.err.network': {
    zh: '连不上 GitHub，请检查网络后重试',
    en: "Can't reach GitHub. Check your network and try again",
  },
  'update.err.rateLimit': {
    zh: 'GitHub 暂时限制了访问次数，请稍后再试',
    en: 'GitHub is limiting requests right now. Try again later',
  },
  'update.err.notReady': { zh: '新版本还没有下载好', en: "The new version hasn't finished downloading" },
} as const
