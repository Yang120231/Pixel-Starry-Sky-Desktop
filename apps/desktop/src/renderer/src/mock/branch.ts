// 演示：回退前的代码检查、旁聊回答（docs/ui/rewind-fork-sidechat.md）
import type { RewindPreview } from '@pixelsky/protocol'

/** 演示会话里回退时要还原的文件：第一条消息说没有检查点，其余列出几处改动 */
export function demoRewindPreview(_sessionId: string, itemId: string, firstUserId: string | null): RewindPreview {
  if (itemId === firstUserId) return { code: { ok: false, reason: 'no-checkpoint' } }
  return {
    code: {
      ok: true,
      files: [
        'src/renderer/src/features/sidebar/Sidebar.tsx',
        'src/renderer/src/features/sidebar/RecentList.tsx',
        'src/renderer/src/styles/globals.css',
      ],
      insertions: 46,
      deletions: 18,
      undoable: true,
    },
  }
}

/** 旁聊的演示回答：按问题里的关键词挑一段 */
export function demoSideAnswer(question: string): string {
  if (/测试|test/i.test(question))
    return '这一轮跑过 `pnpm test`，**128 个测试全部通过**。改动涉及的 `Sidebar.tsx` 有 3 个新测试覆盖最近列表的排序。'
  if (/为什么|why/i.test(question))
    return '因为侧栏原来把最近会话和项目混在一个列表里，滚动时找不到当前项目；拆成两段后：\n\n- 项目固定在上面\n- 最近会话按时间排在下面，最多 8 条'
  return `关于「${question}」：主对话到现在一共改了 3 个文件，主要是侧栏的结构调整，还没有提交。需要细节可以接着问。`
}
