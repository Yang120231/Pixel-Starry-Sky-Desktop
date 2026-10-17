// 导入 / 补上本机会话时放进对话的提示文字（不分引擎；引擎名由调用方传入，不传按 Claude Code）。
/** 导入时放进对话的提示文字（引擎发的中文，界面靠 shared/i18n/systemMessages.ts 翻译；数字原样写在句子里） */
export const NATIVE_TEXT = {
  relayRun: (turns: number) => `以下 ${turns} 轮是在像素星空里用别的引擎聊的，接力时写进了这个会话`,
  handoff: '这一轮带着像素星空的交接材料',
  /** Codex 版：VS Code 扩展加在用户话前面的编辑器上下文 */
  ideContext: '这一轮带着编辑器的上下文',
  /** 读不到 Codex 的会话（没装好 / app-server 起不来）；后面可以接冒号和原因 */
  codexUnavailable: 'Codex 没装好，读不到它的会话',
  gap: (turns: number) => `中间还有 ${turns} 轮没有显示`,
  images: (count: number) => `（${count} 张图片没有导入）`,
  /** 对话最上面的分隔条；missing 是还没显示的更早的轮数 */
  divider: (
    source: 'terminal' | 'other',
    copy: boolean,
    turns: number,
    missing: number,
    engine = 'Claude Code',
  ): string => {
    const base = copy
      ? `复制了${source === 'terminal' ? '终端里' : '其他程序'}的 ${engine} 会话 · ${turns} 轮（原会话不动，两边可以同时用）`
      : source === 'terminal'
        ? `接着终端里的 ${engine} 会话 · ${turns} 轮`
        : `接着 ${engine} 会话（来自其他程序）· ${turns} 轮`
    return missing > 0 ? `${base}（更早的 ${missing} 轮没有显示）` : base
  },
  /** 加载更早的越过压缩边界时，放在压缩条目上面 */
  summaryOnly: '以上是压缩之前的轮次，模型只看到压缩摘要',
  newer: (turns: number) => `这个会话在终端里又聊了 ${turns} 轮，显示里还没有`,
  synced: (turns: number) => `已补上终端里的 ${turns} 轮`,
  gone: '这个会话的记录已经不在了',
  cancelled: '已取消导入',
  earlierGone: '这个会话的记录已经不在了，更早的没法再加载',
  unsupported: '这个引擎不支持接着本机会话',
  /** 原生记录不在了，接力把像素星空里的聊天写进新的引擎会话 */
  recreated: (turns: number, engine = 'Claude Code') =>
    `${engine} 的会话记录不在了，已把像素星空里的聊天（${turns} 轮）写进新的引擎会话（工具调用和文件改动没有带过去）`,
} as const
