// 自动更新的纯函数部分（不依赖 electron，方便测试）

/** GitHub Release 的说明是 HTML（或多个版本的数组）：转成纯文本给界面显示，不把 HTML 交给渲染进程 */
export function notesText(notes: unknown): string | undefined {
  const html = Array.isArray(notes)
    ? notes
        .map(n => (n as { note?: unknown })?.note)
        .filter(n => typeof n === 'string')
        .join('\n\n')
    : typeof notes === 'string'
      ? notes
      : ''
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|pre|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || undefined
}

/** 仓库里还没有可用的发布（例如关掉测试版、但只发过测试版）：当成「已是最新」，不报错 */
export function isNoRelease(message: string): boolean {
  return /No published versions|Unable to find latest version|HttpError: 404|^\s*404\b|Cannot find .*\.yml/i.test(
    message,
  )
}

/** 检查失败的原因：网络问题单独说，其余保留第一行原文 */
export function updateError(message: string): string {
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|net::ERR_/i.test(message))
    return '连不上 GitHub，请检查网络后重试'
  if (/HttpError: 403|rate limit/i.test(message)) return 'GitHub 暂时限制了访问次数，请稍后再试'
  return message.split('\n')[0].slice(0, 200)
}
