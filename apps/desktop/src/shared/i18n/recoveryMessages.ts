// 界面崩溃后自动重新加载（docs/ui/renderer-memory.md §3.1.5）：主进程的系统对话框，和重新加载后界面里的提示
export const recoveryMessages = {
  'recovery.notice.oom': {
    zh: '界面刚才因为内存不足重新加载了。正在运行的对话没有中断。',
    en: 'The window reloaded because it ran out of memory. Running conversations were not interrupted.',
  },
  'recovery.notice.other': {
    zh: '界面刚才意外退出，已经重新加载。正在运行的对话没有中断。',
    en: 'The window stopped unexpectedly and has been reloaded. Running conversations were not interrupted.',
  },
  'recovery.notice.terminals': {
    zh: '终端里的程序已经结束，需要的话在终端里点「重新启动」。',
    en: 'Programs in the terminals were stopped. Use Restart in a terminal if you need it again.',
  },
  'recovery.notice.lightweight': {
    zh: '这次以轻量模式运行：对话只显示最近 20 轮，切走的对话标签不保留在内存里。',
    en: 'Running in lightweight mode: conversations show the latest 20 turns and conversation tabs you switch away from are unloaded.',
  },
  'recovery.notice.ok': { zh: '知道了', en: 'Got it' },
  'recovery.notice.leave': { zh: '退出轻量模式', en: 'Leave lightweight mode' },
  'recovery.dialog.title': { zh: '界面反复退出', en: 'The window keeps crashing' },
  'recovery.dialog.message': {
    zh: '10 分钟内界面已经退出了 {n} 次（最近一次：{reason}）。正在运行的对话不受影响。',
    en: 'The window has stopped {n} times in 10 minutes (last: {reason}). Running conversations are not affected.',
  },
  'recovery.dialog.detail': {
    zh: '可以用轻量模式重新加载：对话只显示最近 20 轮，切走的对话标签不保留。也可以打开日志文件夹，把日志发给我们。',
    en: 'You can reload in lightweight mode (latest 20 turns only, background conversation tabs unloaded), or open the logs folder and send us the logs.',
  },
  'recovery.dialog.reload': { zh: '重新加载（轻量模式）', en: 'Reload (lightweight mode)' },
  'recovery.dialog.openLogs': { zh: '打开日志文件夹', en: 'Open logs folder' },
  'recovery.dialog.quit': { zh: '退出', en: 'Quit' },
  'recovery.reason.oom': { zh: '内存不足', en: 'out of memory' },
  'recovery.reason.other': { zh: '意外退出（{code}）', en: 'unexpected exit ({code})' },
}
