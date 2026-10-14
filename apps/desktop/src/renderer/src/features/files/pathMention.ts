// 文件树「发送路径到对话」插入的 @路径（纯函数，sendPath.ts 用）

/** @路径：文件夹末尾带 /，有空白时加引号（和输入框里 @ 选文件、拖进文件夹的写法一样），末尾一个空格 */
export function pathMention(path: string, folder: boolean): string {
  const shown = path.replaceAll('\\', '/').replace(/\/+$/, '') + (folder ? '/' : '')
  return /\s/.test(shown) ? `@"${shown}" ` : `@${shown} `
}
