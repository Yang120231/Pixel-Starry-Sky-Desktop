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
