// Git LFS 的指针文件（docs/ui/git-panel.md §2.5）：没装 git-lfs 或对象没下载时，Git 里（工作区里也可能）存的是这段文字，
// 不是文件本身。读 Git 里的版本时认出它，再用 `git cat-file --filters` 按 .gitattributes 换成真正的内容。
const POINTER = 'version https://git-lfs.github.com/spec/v1'

export const isLfsPointer = (content: Buffer | string): boolean =>
  content.length < 1024 &&
  (typeof content === 'string'
    ? content.startsWith(POINTER)
    : content.subarray(0, POINTER.length).toString('latin1') === POINTER)
