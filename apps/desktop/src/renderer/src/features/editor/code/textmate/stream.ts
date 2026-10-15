import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language'
import { INITIAL, type IGrammar, type StateStack } from 'vscode-textmate'
import { EXT_LIMITS } from '@pixelsky/protocol'
import { TOKEN_TAGS, tokenForScopes } from '../scopes'
import type { LanguageDataSpec } from './languageConfig'

// vscode-textmate → CodeMirror StreamLanguage：每行 tokenizeLine 一次，结果排进队列，再一段一段交给 CodeMirror

export interface TmState {
  stack: StateStack
  queue: Array<[end: number, token: string | null]>
  pos: number
}

/** 把一行的分词结果压成 [结束位置, 记号] 队列：结束位置不超过行长（引擎会补一个 \n，末尾可能是 length + 1），相邻同记号合并，零宽丢弃 */
function lineQueue(
  tokens: ReadonlyArray<{ startIndex: number; endIndex: number; scopes: string[] }>,
  length: number,
): TmState['queue'] {
  const queue: TmState['queue'] = []
  let last = 0
  for (const t of tokens) {
    const end = Math.min(t.endIndex, length)
    if (end <= last) continue
    const token = tokenForScopes(t.scopes)
    const prev = queue[queue.length - 1]
    if (prev && prev[1] === token) prev[0] = end
    else queue.push([end, token])
    last = end
  }
  if (last < length) queue.push([length, null])
  return queue
}

/** 解析器本身（测试直接驱动它） */
export function tmParser(grammar: IGrammar, languageId: string, data: LanguageDataSpec): StreamParser<TmState> {
  const languageData: Record<string, unknown> = {}
  if (data.commentTokens) languageData.commentTokens = data.commentTokens
  if (data.closeBrackets) languageData.closeBrackets = data.closeBrackets

  const fill = (line: string, state: TmState): void => {
    const result = grammar.tokenizeLine(line, state.stack, EXT_LIMITS.lineMs)
    state.queue = lineQueue(result.tokens, line.length)
    // 超时的那一行保持原来的栈，一行慢不拖累后面（和 VS Code 一样）
    if (!result.stoppedEarly) state.stack = result.ruleStack
  }

  return {
    name: languageId,
    startState: () => ({ stack: INITIAL, queue: [], pos: 0 }),
    copyState: s => ({ stack: s.stack, queue: s.queue.map(e => [e[0], e[1]] as [number, string | null]), pos: s.pos }),
    token(stream: StringStream, state: TmState) {
      if (stream.sol()) {
        if (stream.string.length > EXT_LIMITS.lineChars) {
          stream.skipToEnd()
          state.queue = []
          return null
        }
        fill(stream.string, state)
      }
      const entry = state.queue.shift()
      if (!entry) {
        stream.skipToEnd()
        return null
      }
      stream.pos = Math.min(Math.max(entry[0], stream.pos + 1), stream.string.length)
      state.pos = stream.pos
      return entry[1]
    },
    blankLine(state: TmState) {
      const result = grammar.tokenizeLine('', state.stack, EXT_LIMITS.lineMs)
      if (!result.stoppedEarly) state.stack = result.ruleStack
      state.queue = []
    },
    tokenTable: TOKEN_TAGS,
    languageData,
  }
}

export function tmStreamLanguage(
  grammar: IGrammar,
  languageId: string,
  data: LanguageDataSpec,
): StreamLanguage<TmState> {
  return StreamLanguage.define(tmParser(grammar, languageId, data))
}
