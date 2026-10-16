/**
 * Codex 给的 command 是 argv 用 shlex 拼成的一行，外面包着一层 shell
 * （Windows 上是 `"C:\\…\\powershell.exe" -Command "…"`，其他平台是 `/bin/bash -lc '…'`）。
 * 显示时去掉这层，只留里面的脚本（Codex App 也这么显示）；认不出来的原样返回
 */
export function codexCommand(line: string): string {
  const argv = shellWords(line)
  if (!argv || argv.length < 2) return line
  const name = argv[0]!
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')
  let at = -1
  if (/^(?:ba|z|da|k)?sh$/.test(name)) {
    // bash -lc / -c / -l -c：脚本是最后一个参数，前面只能是短选项
    const flags = argv.slice(1, -1)
    if (flags.length && flags.every(f => /^-[a-z]+$/.test(f)) && flags.some(f => f.includes('c'))) at = argv.length - 1
  } else if (name === 'powershell' || name === 'pwsh')
    at = argv.findIndex((a, i) => i > 0 && /^-c(?:ommand)?$/i.test(a)) + 1
  else if (name === 'cmd') at = argv.findIndex((a, i) => i > 0 && /^\/c$/i.test(a)) + 1
  if (at <= 0 || at >= argv.length) return line
  const script = argv.slice(at).join(' ').trim()
  return script || line
}

/** 按 POSIX shell 的引号规则拆词（shlex 拼接的逆过程）；引号没闭合返回 null */
export function shellWords(line: string): string[] | null {
  const words: string[] = []
  let word = '',
    has = false,
    i = 0
  while (i < line.length) {
    const c = line[i]!
    if (/\s/.test(c)) {
      if (has) words.push(word)
      word = ''
      has = false
      i++
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) return null
      word += line.slice(i + 1, end)
      has = true
      i = end + 1
    } else if (c === '"') {
      i++
      for (;;) {
        if (i >= line.length) return null
        const d = line[i]!
        if (d === '"') break
        // 双引号里反斜杠只转义 $ ` " \ 和换行，其他照原样留着
        if (d === '\\' && i + 1 < line.length && '$`"\\\n'.includes(line[i + 1]!)) {
          if (line[i + 1] !== '\n') word += line[i + 1]
          i += 2
        } else {
          word += d
          i++
        }
      }
      has = true
      i++
    } else if (c === '\\' && i + 1 < line.length) {
      if (line[i + 1] !== '\n') word += line[i + 1]
      has = true
      i += 2
    } else {
      word += c
      has = true
      i++
    }
  }
  if (has) words.push(word)
  return words
}
