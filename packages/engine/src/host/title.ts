// 新会话标题：第一条消息的第一行
export const NEW_TITLE = '新会话'
const TITLE_MAX = 30

export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0].trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line || NEW_TITLE
}
