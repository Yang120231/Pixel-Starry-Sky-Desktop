import type { ContextWindow } from '@pixelsky/protocol'
/** 只在演示模式显示；默认真实会话没有请求时为未知。 */
export const demoContext: ContextWindow = {
  model: 'claude-opus-5-5',
  used: 166000,
  window: 200000,
  input: 8000,
  cacheRead: 150000,
  cacheWrite: 8000,
  output: 2400,
  observedAt: Date.now(),
  source: 'diagnostic',
  stale: false,
  compacting: false,
  diagnosticStale: false,
  diagnostic: {
    model: 'claude-opus-5-5',
    used: 166000,
    window: 200000,
    observedAt: Date.now(),
    categories: [
      { name: 'System prompt', tokens: 7000, kind: 'used' },
      { name: 'System tools', tokens: 23000, kind: 'used' },
      { name: 'MCP tools', tokens: 5000, kind: 'used' },
      { name: 'Messages', tokens: 123000, kind: 'used' },
      { name: 'Memory files', tokens: 3000, kind: 'used' },
      { name: 'Skills', tokens: 5000, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 13000, kind: 'buffer' },
      { name: 'Free space', tokens: 21000, kind: 'free' },
    ],
    tools: [{ name: '文件与浏览器工具', tokens: 5000 }],
    // 记忆文件是引擎给的绝对路径：项目里的、用户目录下的（演示的项目在 D:\pixel-web，用户目录 C:\Users\linxia）
    memory: [
      { name: 'D:\\pixel-web\\CLAUDE.md', tokens: 1800, source: 'Project' },
      { name: 'C:\\Users\\linxia\\.claude\\CLAUDE.md', tokens: 900, source: 'User' },
      { name: 'C:\\Users\\linxia\\.claude\\projects\\D--pixel-web\\memory\\MEMORY.md', tokens: 300, source: 'AutoMem' },
    ],
    agents: [],
    skills: [{ name: '演示项目技能', tokens: 5000, source: 'workspace' }],
  },
}
