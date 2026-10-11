import { describe, expect, it } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { fileLanguage, loadLanguage } from './languages'

const highlighter = tagHighlighter([
  { tag: tags.comment, class: 'comment' },
  { tag: tags.keyword, class: 'keyword' },
  { tag: tags.string, class: 'string' },
  { tag: [tags.number, tags.atom, tags.bool, tags.null], class: 'literal' },
  { tag: tags.meta, class: 'meta' },
  { tag: [tags.className, tags.typeName], class: 'type' },
  { tag: tags.function(tags.variableName), class: 'function' },
  { tag: tags.propertyName, class: 'key' },
  { tag: tags.heading, class: 'heading' },
  { tag: [tags.tagName, tags.attributeName], class: 'tag' },
])

/** 按语言解析 doc，返回查某段文字颜色类别的函数（看这段文字第一个字符；旧版 properties 模式一个字符一个 token） */
async function colored(path: string, doc: string): Promise<Record<string, string | undefined>> {
  const language: Extension = await loadLanguage(path)
  const state = EditorState.create({ doc, extensions: [language] })
  const tree = ensureSyntaxTree(state, doc.length, 5000)!
  const classes: (string | undefined)[] = []
  highlightTree(tree, highlighter, (from, to, cls) => {
    for (let i = from; i < to; i++) classes[i] = cls
  })
  return new Proxy({}, { get: (_, text: string) => classes[doc.indexOf(text)] })
}

describe('编辑器语言（issue #4）', () => {
  it('新增的语言按扩展名和文件名认出来', () => {
    const cases: Record<string, string> = {
      'src/Main.java': 'Java',
      'app/Main.kt': 'Kotlin',
      'build.gradle.kts': 'Kotlin',
      'build.gradle': 'Groovy',
      'scripts/a.groovy': 'Groovy',
      'Main.scala': 'Scala',
      'main.c': 'C',
      'main.h': 'C',
      'main.cpp': 'C++',
      'main.hpp': 'C++',
      'Program.cs': 'C#',
      'pom.xml': 'XML',
      'icon.svg': 'XML',
      'Info.plist': 'XML',
      'gradle.properties': 'Properties',
      'setup.cfg': 'INI',
      'config.INI': 'INI',
      Dockerfile: 'Dockerfile',
      'deploy/Dockerfile.dev': 'Dockerfile',
      Containerfile: 'Dockerfile',
      'api.dockerfile': 'Dockerfile',
    }
    for (const [path, expected] of Object.entries(cases)) expect(fileLanguage(path), path).toBe(expected)
    expect(fileLanguage('dockerfiles/readme.txt')).toBe('纯文本')
  })

  it('每种新增语言都能加载', async () => {
    for (const path of [
      'a.java',
      'a.kt',
      'a.scala',
      'a.groovy',
      'a.c',
      'a.cpp',
      'a.cs',
      'a.xml',
      'a.properties',
      'a.ini',
      'Dockerfile',
    ])
      expect(await loadLanguage(path), path).toBeTruthy()
  })

  it('Java：注解、类名、类型名、方法名、关键字、字符串、注释、字面量分别上色，常量不当类型', async () => {
    const c = await colored(
      'A.java',
      '/** doc */\n@Deprecated\npublic final class Registry {\n  static final int LIMIT = 64;\n  void addKey(int n) {\n    String s = "x";\n    if (s == null) return;\n  }\n}\n',
    )
    expect(c['/** doc */']).toBe('comment')
    expect(c['@Deprecated']).toBe('meta')
    expect(c['class']).toBe('keyword')
    expect(c['Registry']).toBe('type')
    expect(c['String']).toBe('type')
    expect(c['LIMIT']).toBeUndefined()
    expect(c['addKey']).toBe('function')
    expect(c['"x"']).toBe('string')
    expect(c['64']).toBe('literal')
    expect(c['null']).toBe('literal')
  })

  it('Kotlin 的 val 名字不当成类名或函数名，fun 名字按函数名', async () => {
    const c = await colored('A.kt', 'class Foo {\n  val size = 1\n  fun grow() {}\n}\n')
    expect(c['Foo']).toBe('type')
    expect(c['grow']).toBe('function')
    expect(c['size']).toBeUndefined()
  })

  it('XML 标签、properties 的键值和小节、JSON 的键都有颜色', async () => {
    const xml = await colored('a.xml', '<project version="1">\n</project>\n')
    expect(xml['project']).toBe('tag')
    expect(xml['"1"']).toBe('string')
    const props = await colored('a.ini', '[server]\nport=8080\n# note\n')
    expect(props['[server]']).toBe('heading')
    expect(props['port']).toBe('key')
    expect(props['8080']).toBe('string')
    expect(props['# note']).toBe('comment')
    const json = await colored('a.json', '{"name": "x"}')
    expect(json['"name"']).toBe('key')
  })
})
