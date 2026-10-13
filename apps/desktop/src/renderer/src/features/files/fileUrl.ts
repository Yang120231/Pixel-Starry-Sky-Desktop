// 本地文件路径 → file:// 地址（纯函数，htmlPreview.ts 和测试共用）
export const isHtmlPath = (path: string): boolean => /\.html?$/i.test(path)

/** 项目根目录 + 相对路径 → file:// 地址（Windows 盘符、反斜杠、空格和中文都转好） */
export function fileUrl(root: string, path: string): string {
  const full = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/${path.replaceAll('\\', '/').replace(/^\.?\//, '')}`
  const encoded = full
    .split('/')
    .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return /^[a-z]:\//i.test(full) ? `file:///${encoded}` : `file://${encoded}`
}
