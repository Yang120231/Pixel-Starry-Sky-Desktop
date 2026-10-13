// 界面进程的内存采样（docs/ui/renderer-memory.md §3.2.1）：界面每隔一阵经 log.sample() 报给主进程
export interface RendererMemorySample {
  /** performance.memory */
  heapUsedMb: number
  heapTotalMb: number
  heapLimitMb: number
  /** 和「界面卡住」同一个数法（document.getElementsByTagName('*').length） */
  elements: number
  /** 挂着内容的标签数 */
  mountedTabs: number
  /** 挂着的对话流（LiveTranscript）个数 */
  sessionViews: number
  /** 各对话流实际显示的轮数，取最大 */
  shownTurnsMax: number
  /** 快照个数 */
  snapshots: number
  /** 快照里的条目总数 */
  snapshotItems: number
  /** 条目里字符串长度之和（不含 dataBase64），按 2 字节 / 字符折算 */
  snapshotTextMb: number
  /** 所有 dataBase64 的长度之和 */
  imageB64Mb: number
  /** xterm 个数、各终端 buffer.normal.length 之和 */
  terminals: number
  terminalLines: number
  /** CodeEditor 实例数 */
  codeEditors: number
  lightweight: boolean
}
