// 引擎启动参数的拆分与拼回（docs/ui/engine-launch.md §3）：界面里是一行文字，保存的是参数数组。
// 规则按命令行习惯：空白分隔，单引号、双引号包起来的算一个参数，相邻的引号段连成一个参数。
// 反斜杠不当转义（Windows 路径里全是反斜杠）；要写引号就用另一种引号包起来。

/** 拆成参数数组；引号没配对时返回 null */
export function splitArgs(text: string): string[] | null {
  const out: string[] = []
  let cur = ''
  /** 当前参数是否已开始（空引号 "" 也算一个参数） */
  let started = false
  let quote: '"' | "'" | null = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur)
      cur = ''
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (quote) return null
  if (started) out.push(cur)
  return out
}

/** 拼回一行文字，splitArgs 能原样拆回 */
export function joinArgs(args: readonly string[]): string {
  return args
    .map(a => {
      if (a && !/[\s"']/.test(a)) return a
      if (!a.includes('"')) return `"${a}"`
      if (!a.includes("'")) return `'${a}'`
      // 两种引号都有：双引号包起来，里面的双引号单独用单引号包
      return `"${a.replace(/"/g, `"'"'"`)}"`
    })
    .join(' ')
}
