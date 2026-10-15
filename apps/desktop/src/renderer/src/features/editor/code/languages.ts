import { tr } from '../../../i18n/core'
import type { Extension } from '@codemirror/state'
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { keyHighlight } from './theme'
import { builtinLanguageName } from './builtinLanguages'
import { packGrammarForPath } from './languageIds'
import { textmateLanguage } from './textmate'

/** 内置名字永远不被扩展替换（编辑器里有按 Markdown 判断的逻辑）；没有内置的再看扩展语法 */
export function fileLanguage(path: string): string {
  const builtin = builtinLanguageName(path)
  if (builtin) return builtin
  const grammar = packGrammarForPath(path)?.grammar
  return grammar
    ? (grammar.aliases?.[0] ?? grammar.language ?? tr('code.highlight.plainText'))
    : tr('code.highlight.plainText')
}

/**
 * 旧版 clike 模式只把顶层声明的名字标成 def（类名、C 的函数名、Kotlin 的 val 都是），类里的方法名和调用都是普通变量。
 * 跟在 class / interface / enum 这类关键字后面的按类名上色；后面紧跟 ( 的按函数名上色（和 TS、Python 一样，调用也算）；
 * 其余大写开头的类型名（包括 String 这类内置类型）按类型上色
 */
function clikeDefinitions<S>(parser: StreamParser<S>): StreamParser<S> {
  return {
    ...parser,
    token(stream, state) {
      const style = parser.token(stream, state)
      if (style !== 'def' && style !== 'variable' && style !== 'builtin') return style
      const before = stream.string.slice(0, stream.start)
      if (style === 'def' && /\b(class|interface|enum|object|trait|record|struct|typealias|type)\s+$/.test(before))
        return 'defType'
      if (/^\s*\(/.test(stream.string.slice(stream.pos))) return 'callable'
      // 这些语言里大写开头、后面有小写的名字基本是类型（String、ResourceLocation）；全大写的是常量，不算
      if (/^[A-Z][A-Za-z0-9_]*[a-z]/.test(stream.current())) return 'defType'
      return style
    },
    tokenTable: { callable: tags.function(tags.variableName), defType: tags.className },
  }
}

export async function loadLanguage(path: string, firstLine?: string): Promise<Extension> {
  const ref = packGrammarForPath(path, firstLine)
  if (ref) return textmateLanguage(ref)
  const builtin = builtinLanguageName(path)
  switch (builtin) {
    case 'TypeScript':
    case 'TSX':
    case 'JavaScript':
    case 'JSX': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({
        typescript: builtin === 'TypeScript' || builtin === 'TSX',
        jsx: builtin === 'JSX' || builtin === 'TSX',
      })
    }
    case 'JSON': {
      const support = (await import('@codemirror/lang-json')).json()
      return [support, keyHighlight(support.language)]
    }
    case 'CSS':
      return (await import('@codemirror/lang-css')).css()
    case 'HTML':
      return (await import('@codemirror/lang-html')).html()
    case 'Markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'Python':
      return (await import('@codemirror/lang-python')).python()
    case 'Rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'Go':
      return (await import('@codemirror/lang-go')).go()
    case 'YAML': {
      const support = (await import('@codemirror/lang-yaml')).yaml()
      return [support, keyHighlight(support.language)]
    }
    case 'SQL':
      return (await import('@codemirror/lang-sql')).sql()
    case 'TOML':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'Shell':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)
    case 'Java':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).java))
    case 'Kotlin':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).kotlin))
    case 'Scala':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).scala))
    case 'C':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).c))
    case 'C++':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).cpp))
    case 'C#':
      return StreamLanguage.define(clikeDefinitions((await import('@codemirror/legacy-modes/mode/clike')).csharp))
    case 'Groovy':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/groovy')).groovy)
    case 'XML':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/xml')).xml)
    case 'Properties':
    case 'INI': {
      // 旧模式把键标成 def、值标成 quote，换成属性名和字符串才有颜色（def 是内置名字，tokenTable 改不了）；
      // [小节] 是 header，按标题上色
      const { properties } = await import('@codemirror/legacy-modes/mode/properties')
      const language = StreamLanguage.define({
        ...properties,
        token(stream, state) {
          const style = properties.token(stream, state)
          return style === 'def' ? 'propertyName' : style === 'quote' ? 'string' : style
        },
      })
      return [language, keyHighlight(language)]
    }
    case 'Dockerfile':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)
    default:
      return []
  }
}
