import { readFileSync, readdirSync } from 'node:fs'

const vmRssMb = (pid: number | string): number => {
  try {
    const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
    return m ? Number(m[1]) / 1024 : 0
  } catch {
    return 0
  }
}

/** 远端（本进程 + 所有子孙进程）的内存占用；非 Linux 没有 /proc，只报本进程。 */
export function collectStats(): { rssMb: number; processes: number } {
  if (process.platform !== 'linux')
    return { rssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10, processes: 1 }
  const children = new Map<number, number[]>()
  try {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      try {
        // comm 可能带空格和括号，从最后一个 ")" 之后取 state、ppid
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
        const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        const ppid = Number(rest[1])
        if (!children.has(ppid)) children.set(ppid, [])
        children.get(ppid)!.push(Number(name))
      } catch {
        /* 进程刚退出 */
      }
    }
  } catch {
    /* /proc 不可读：只算本进程 */
  }
  let rssMb = vmRssMb('self'),
    processes = 1
  const queue = [...(children.get(process.pid) ?? [])]
  const seen = new Set<number>([process.pid])
  while (queue.length) {
    const pid = queue.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    rssMb += vmRssMb(pid)
    processes++
    queue.push(...(children.get(pid) ?? []))
  }
  return { rssMb: Math.round(rssMb * 10) / 10, processes }
}
