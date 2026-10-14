// 对话里的文件夹链接（docs/ui/path-click.md）：让文件树展开到某个文件夹。
// 按项目根目录的完整路径认是哪棵树（会话和项目的 ref 不一样，路径一样）；文件树还没挂上时先记着，挂上后 FileTree 来取
let pending: { root: string; path: string } | null = null
export const REVEAL_FOLDER_EVENT = 'pixelsky:file-tree-reveal-folder'

export function revealFolderInTree(root: string, path: string): void {
  pending = { root, path }
  window.dispatchEvent(new CustomEvent(REVEAL_FOLDER_EVENT))
}

/** 取走要展开的文件夹：根目录要对得上（match 判断），对不上时留着给别的文件树 */
export function takeFolderReveal(match: (root: string) => boolean): { root: string; path: string } | null {
  if (!pending || !match(pending.root)) return null
  const want = pending
  pending = null
  return want
}
