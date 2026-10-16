// 演示模式里「接着终端里的 Claude Code 会话」（docs/ui/claude-resume.md）：几行覆盖选择框的各种状态。
// 第一步的列表里最后一句和模型是空的，第二步（details）才补上，演示逐步补的样子；导入只是跳到一个现成的展示对话
import type { NativeImportResult, NativeSessionDetail, NativeSessionSummary } from '@pixelsky/protocol'
import type { DemoSource } from '@/data/demo'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Row = Omit<NativeSessionSummary, 'updatedAt'> & { ago: number; last: string }

const ROWS: Row[] = [
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1001',
    title: '修复 Caddy 超时',
    firstPrompt: '测试站上传大文件会 499，帮我看一下 Caddy 的超时',
    lastPrompt: null,
    branch: 'main',
    subdir: null,
    size: 4_800_000,
    model: null,
    source: 'terminal',
    ownerId: null,
    live: null,
    ago: 12 * MIN,
    last: '部署后再看一下 499 还有没有',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1002',
    title: '调手机端布局',
    firstPrompt: '手机端底部输入框被键盘顶起来了',
    lastPrompt: null,
    branch: 'main',
    subdir: 'apps/mobile',
    size: 1_200_000,
    model: null,
    source: 'terminal',
    ownerId: null,
    live: null,
    ago: 4 * DAY,
    last: '再截一张图',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1003',
    title: '规划 /resume',
    firstPrompt: '规划一下怎么在像素星空里接着终端里的 Claude Code 会话',
    lastPrompt: null,
    branch: 'main',
    subdir: null,
    size: 23_000_000,
    model: null,
    source: 'terminal',
    // 已被像素星空的对话占用：点了跳到那个对话
    ownerId: 'demo-claude-tools',
    live: null,
    ago: 2 * HOUR,
    last: '先出规划',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1004',
    title: '发布 0.4.7',
    firstPrompt: '把版本改成 0.4.7-beta，更新说明改名',
    lastPrompt: null,
    branch: 'release/0.4.7',
    subdir: null,
    size: 9_500_000,
    model: null,
    source: 'terminal',
    ownerId: null,
    live: 'terminal',
    ago: 40_000,
    last: '检查一下 CI 有没有过',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1005',
    title: '整理 CC-Panes 项目清单',
    firstPrompt: '把 .ccpanes/projects.csv 里失效的目录去掉',
    lastPrompt: null,
    branch: 'main',
    subdir: null,
    size: 600_000,
    model: null,
    source: 'other',
    ownerId: null,
    live: 'other',
    ago: 3 * MIN,
    last: '好了，帮我提交',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1006',
    title: '重构 extpacks 校验',
    firstPrompt: '扩展包的校验逻辑太散了，抽成一个模块',
    lastPrompt: null,
    branch: 'HEAD',
    subdir: null,
    size: 221 * 1024 * 1024,
    model: null,
    source: 'other',
    ownerId: null,
    live: null,
    ago: 3 * DAY,
    last: '跑一下全量检查',
  },
  {
    id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1007',
    title: '调试模型菜单',
    firstPrompt: '模型菜单里 Opus 不显示',
    lastPrompt: null,
    branch: 'main',
    subdir: null,
    size: 2_100_000,
    model: null,
    source: 'other',
    ownerId: null,
    // 读不到 pid 登记、只看记录修改时间：可能还开着
    live: 'maybe',
    ago: 90_000,
    last: '再试一次',
  },
]

const MODELS = ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5']

export const demoNativeSessions: DemoSource['conversations']['nativeSessions'] = {
  list: () => {
    const now = Date.now()
    return ROWS.map(({ ago, last: _last, ...row }) => ({ ...row, updatedAt: now - ago }))
  },
  details: ids => {
    const now = Date.now()
    return ids.flatMap<NativeSessionDetail>(id => {
      const index = ROWS.findIndex(r => r.id === id)
      const row = ROWS[index]
      if (!row) return []
      return [
        {
          id,
          lastPrompt: row.last,
          title: row.title,
          lastActive: now - row.ago,
          model: MODELS[index % MODELS.length],
          branch: row.branch,
          superseded: false,
          skipped: false,
        },
      ]
    })
  },
  import: (nativeId, mode): NativeImportResult => {
    const row = ROWS.find(r => r.id === nativeId)
    if (row?.ownerId) return { ownerId: row.ownerId }
    if (mode === 'inplace' && (row?.live === 'terminal' || row?.live === 'other')) return { live: row.live }
    return { sessionId: 'demo-claude-long', model: 'claude-opus-4-1', turns: 120, shown: 50 }
  },
}
