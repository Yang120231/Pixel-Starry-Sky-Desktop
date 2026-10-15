// 扩展任务模板在渲染进程这边的入口（只有 tasks/store.ts 用）：从扩展 store 取出生效的模板。
// 命令拼装在 extCommand.ts，那边不引用 store
import type { ExtTaskTemplateWire } from '@pixelsky/protocol'
import { contributionsOf } from '@/features/extpacks/store'

/** 生效扩展里的任务模板，index 是清单下标；传给主进程（或远程运行时）去读项目里的文件 */
export function activeTaskTemplates(): ExtTaskTemplateWire[] {
  return contributionsOf('taskTemplates').map(c => ({
    packKey: c.pack.key,
    packId: c.pack.id ?? c.pack.key,
    index: c.index,
    template: c.item,
  }))
}

/** 模板认的文件名（保存了这些文件就要重新读任务） */
export function extTaskFileNames(): Set<string> {
  return new Set(activeTaskTemplates().flatMap(t => t.template.files))
}
