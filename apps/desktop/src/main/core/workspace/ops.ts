// 项目文件读写（docs/ui/open-in-editor.md）：本机与远端共用的操作表。显示文件夹、复制路径只在本机（workspace-ipc.ts）
import type { OpTable } from '../ops'
import { workspaceRef, type WorkspaceFiles } from '../workspace-files'

export interface FileOpContext {
  files: WorkspaceFiles
}

export const FILE_OPS = {
  'files:target': (c, ref) => c.files.target(ref),
  'files:list': (c, ref, path) => c.files.list(workspaceRef(ref), path as string),
  'files:search': (c, ref, name) => c.files.search(workspaceRef(ref), name as string),
  'files:status': (c, ref) => c.files.status(workspaceRef(ref)),
  'files:read': (c, ref, path) => c.files.read(workspaceRef(ref), path as string),
  'files:headContent': (c, ref, path) => c.files.headContent(workspaceRef(ref), path as string),
  'files:save': (c, ref, path, text, version) =>
    c.files.save(workspaceRef(ref), path as string, text as string, version as string),
} satisfies OpTable<FileOpContext>
