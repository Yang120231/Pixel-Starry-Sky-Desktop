export const SESSION_TITLE_LIMIT = 200

export function sessionTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('会话名称不能为空')
  // eslint-disable-next-line no-control-regex -- 故意匹配控制字符，拒绝包含换行等控制字符的会话名称
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('会话名称不能包含换行或控制字符')
  const title = value.trim()
  if (Array.from(title).length > SESSION_TITLE_LIMIT) throw new Error('会话名称不能超过 200 个字符')
  return title
}

/** 普通项保持输入顺序；置底项按设置先后排在普通项之后。 */
export function bottomOrder(a: { bottomedAt?: number | null }, b: { bottomedAt?: number | null }): number {
  const left = a.bottomedAt ?? 0,
    right = b.bottomedAt ?? 0
  return Number(left > 0) - Number(right > 0) || (left > 0 && right > 0 ? left - right : 0)
}

/** 置顶分组的顺序：后置顶的在上面 */
export function pinnedOrder(a: { pinnedAt?: number | null }, b: { pinnedAt?: number | null }): number {
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
}

/**
 * 不用项目的对话（像 Codex 的无项目对话）：所有这类会话挂在这个内置项目下，它不在项目列表里。
 * 每个对话在数据目录的 chats/<会话 ID> 下有一个自己的空文件夹。远端机器上的 ID 带机器前缀（ssh-…~chat）
 */
export const CHAT_PROJECT_ID = 'chat'

/** 是不是「对话」这个内置项目（本机或远端机器的） */
export function isChatProject(id: string | null | undefined): boolean {
  return id === CHAT_PROJECT_ID || (!!id && id.endsWith('~' + CHAT_PROJECT_ID))
}

export const PROJECT_NAME_LIMIT = 100

/** 项目显示名：只影响侧栏显示，不改磁盘上的文件夹名 */
export function projectName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('项目名称不能为空')
  // eslint-disable-next-line no-control-regex -- 故意匹配控制字符，拒绝包含换行等控制字符的项目名称
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('项目名称不能包含换行或控制字符')
  const name = value.trim()
  if (Array.from(name).length > PROJECT_NAME_LIMIT) throw new Error('项目名称不能超过 100 个字符')
  return name
}
