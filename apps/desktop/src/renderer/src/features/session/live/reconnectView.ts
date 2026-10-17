import type { Item } from '@pixelsky/protocol'

const isTurnStart = (item: Item): boolean => item.kind === 'user' && item.mode !== 'guidance'
const isMarker = (item: Item | undefined): boolean => item?.kind === 'user' && !!item.reconnect
const isError = (item: Item): boolean => item.kind === 'notice' && item.level === 'error'

/**
 * 断线自动重连在对话里的样子：宿主自动发的「继续」显示成一行小字（不是用户气泡）。
 * 后面接着重连了的那一轮，断线报错不再显示；连着几次都没接上的只留最后一行，写「断开 n 次」。
 * pending：现在正在等下一次重连（重连卡片在显示），最后一轮的报错和小字也先收起来。
 * failed：重连后这一轮还是出错了的小字（不写「已重连」）。
 */
export function reconnectView(items: Item[], pending: boolean): { items: Item[]; failed: Set<string> } {
  const failed = new Set<string>()
  if (!pending && !items.some(isMarker)) return { items, failed }
  const starts: number[] = []
  items.forEach((item, i) => isTurnStart(item) && starts.push(i))
  const drop = new Set<number>()
  starts.forEach((start, n) => {
    const end = starts[n + 1] ?? items.length
    const next = items[starts[n + 1]]
    const last = n === starts.length - 1
    const followed = isMarker(next) || (last && pending)
    let errors = 0
    let others = 0
    for (let i = start + 1; i < end; i++)
      if (isError(items[i])) {
        errors++
        if (followed) drop.add(i)
      } else others++
    if (!isMarker(items[start])) return
    if (followed && others === 0) drop.add(start)
    else if (errors > 0 && !followed) failed.add(items[start].id)
  })
  return { items: drop.size ? items.filter((_, i) => !drop.has(i)) : items, failed }
}
