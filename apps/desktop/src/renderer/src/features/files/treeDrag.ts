// 文件树拖动移动（drag-move.plan.md §4.1）：数据格式和「放下后进哪个文件夹」的纯函数
import type { WorkspaceRef } from '../../../../shared/types/workspace'

export const FILE_DRAG_TYPE = 'application/x-pixelsky-file'

export interface DragSource {
  ref: WorkspaceRef
  /** 相对项目的路径 */
  path: string
  kind: 'file' | 'directory'
  name: string
}

/** 鼠标悬停的位置：项目名行、文件夹行或文件行 */
export type DragOver =
  | { ref: WorkspaceRef; kind: 'root' }
  | { ref: WorkspaceRef; kind: 'file' | 'directory'; path: string; linked?: boolean }

export const refKey = (ref: WorkspaceRef): string => ref.projectId ?? ref.sessionId ?? ''
export const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')
export const join2 = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name)

/** 放下后进哪个文件夹（'' 是项目根目录）；不能放返回 null */
export function dropTarget(source: DragSource, over: DragOver): { folder: string } | null {
  // 不同项目可能在不同机器上，第一版不做跨项目
  if (refKey(source.ref) !== refKey(over.ref)) return null
  let folder: string
  if (over.kind === 'root') folder = ''
  else if (over.kind === 'directory') {
    // 符号链接文件夹可能指到项目外面
    if (over.linked) return null
    folder = over.path
  } else folder = parentOf(over.path)
  // 放回原来的文件夹等于没动
  if (folder === parentOf(source.path)) return null
  // 文件夹不能放进自己或子孙；按 '/' 分段比，src 和 src2 不是父子
  if (source.kind === 'directory' && (folder === source.path || folder.startsWith(source.path + '/'))) return null
  return { folder }
}

/** 放下后的新路径 */
export const movedPath = (source: DragSource, folder: string): string => join2(folder, source.name)

/** 写进 dataTransfer：自定义类型给树自己用，text/plain 的相对路径给别的程序用 */
export function writeDragData(data: DataTransfer, source: DragSource): void {
  data.setData(FILE_DRAG_TYPE, JSON.stringify(source))
  data.setData('text/plain', source.path)
  data.effectAllowed = 'move'
}

export const hasFileDrag = (data: DataTransfer): boolean => data.types.includes(FILE_DRAG_TYPE)
