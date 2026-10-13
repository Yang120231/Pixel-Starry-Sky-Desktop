/** 流式输出的切块结果：completed 是已经写完的块，tail 是还在写的最后一段；两者拼起来正好是原文 */
export interface StreamBlocks {
  completed: string[]
  tail: string
}

// 围栏前的缩进不限：列表项里的代码块常缩进 4 格以上，认少了会把围栏里的空行当成切分点（多认只会少切，是安全的方向）
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/

/**
 * 增量切块器：返回的函数每次传入目前的全文。新文字是在上次的文字后面接着写时，
 * 只从上次扫到的位置往后扫，每次的开销和新增文字成正比；对不上（换了内容）就从头来。
 * 块都是原文的子串（含结尾的空行），同一段文字多次切出来的字符串完全相同，memo 才能命中。
 */
export function createStreamSplitter(): (text: string) => StreamBlocks {
  let prev = ''
  let completed: string[] = []
  let blockStart = 0
  let hasContent = false // 当前块里是否已经有非空行；全是空行的不单独成块
  let fenceChar = ''
  let fenceLen = 0
  let pos = 0
  return text => {
    if (!text.startsWith(prev)) {
      completed = []
      blockStart = 0
      hasContent = false
      fenceChar = ''
      fenceLen = 0
      pos = 0
    }
    prev = text
    while (pos < text.length) {
      const nl = text.indexOf('\n', pos)
      // 没有换行的最后一行还在写，不可能是切分点；pos 停在这一行开头，下次整行重扫
      if (nl === -1) break
      const line = text.slice(pos, nl).replace(/\r$/, '')
      const next = nl + 1
      const m = FENCE.exec(line)
      if (fenceChar) {
        // 闭合围栏：同样的字符、不短于开头、后面只能是空白
        if (m && m[1][0] === fenceChar && m[1].length >= fenceLen && m[2].trim() === '') fenceChar = ''
      } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
        // 反引号围栏的说明文字里不能再有反引号，否则是行内代码
        fenceChar = m[1][0]
        fenceLen = m[1].length
        hasContent = true
      } else if (line.trim() === '') {
        if (hasContent) {
          completed.push(text.slice(blockStart, next))
          blockStart = next
          hasContent = false
        }
      } else {
        hasContent = true
      }
      pos = next
    }
    return { completed: completed.slice(), tail: text.slice(blockStart) }
  }
}

/**
 * 把流式文字按空行切成「已完成的块 + 未完成的尾巴」，让已完成的块不再重新解析。
 * 围栏代码块（``` / ~~~）里的空行不切；围栏没闭合，从围栏起到末尾都算尾巴。
 * 一次性切分；流式里逐字追加用 createStreamSplitter。
 */
export function splitStreamBlocks(text: string): StreamBlocks {
  return createStreamSplitter()(text)
}
