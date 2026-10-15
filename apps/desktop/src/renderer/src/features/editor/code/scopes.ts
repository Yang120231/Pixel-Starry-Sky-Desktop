import { tags, type Tag } from '@lezer/highlight'

// TextMate 作用域 ↔ CodeMirror 标签的对照表：语法桥（textmate/）和主题转换（colorTheme/）共用。纯数据，没有副作用。

export type ScopeToken =
  | 'comment'
  | 'string'
  | 'regexp'
  | 'number'
  | 'bool'
  | 'escape'
  | 'character'
  | 'constant'
  | 'controlKeyword'
  | 'operator'
  | 'keyword'
  | 'definitionKeyword'
  | 'modifier'
  | 'function'
  | 'typeName'
  | 'className'
  | 'tagName'
  | 'attributeName'
  | 'propertyName'
  | 'meta'
  | 'heading'
  | 'parameter'
  | 'self'
  | 'variableName'
  | 'stringPunctuation'
  | 'punctuation'
  | 'strong'
  | 'emphasis'
  | 'link'
  | 'inserted'
  | 'deleted'
  | 'invalid'

/** 作用域前缀 → 记号；取最长前缀，所以 support.type.property-name 比 support.type 优先 */
export const SCOPE_TABLE: ReadonlyArray<readonly [prefix: string, token: ScopeToken]> = [
  ['comment', 'comment'],
  ['string', 'string'],
  ['string.regexp', 'regexp'],
  ['constant.numeric', 'number'],
  ['constant.language', 'bool'],
  ['constant.character.escape', 'escape'],
  ['constant.character', 'character'],
  ['constant.other', 'constant'],
  ['variable.other.constant', 'constant'],
  ['keyword.control', 'controlKeyword'],
  ['keyword.operator', 'operator'],
  ['keyword', 'keyword'],
  ['storage.type', 'definitionKeyword'],
  ['storage.modifier', 'modifier'],
  ['entity.name.function', 'function'],
  ['support.function', 'function'],
  ['entity.name.type', 'typeName'],
  ['support.type', 'typeName'],
  ['entity.name.class', 'className'],
  ['support.class', 'className'],
  ['entity.name.tag', 'tagName'],
  ['entity.other.attribute-name', 'attributeName'],
  ['entity.name.section', 'heading'],
  ['markup.heading', 'heading'],
  ['support.type.property-name', 'propertyName'],
  ['meta.object-literal.key', 'propertyName'],
  ['variable.other.property', 'propertyName'],
  ['entity.name.tag.yaml', 'propertyName'],
  ['meta.mapping.key', 'propertyName'],
  // 注解：这是唯一的 meta.* 条目，其余 meta.* / source.* / text.* 都不上色
  ['meta.decorator', 'meta'],
  ['meta.annotation', 'meta'],
  ['storage.type.annotation', 'meta'],
  ['punctuation.decorator', 'meta'],
  ['entity.name.function.decorator', 'meta'],
  ['variable.parameter', 'parameter'],
  ['variable.language', 'self'],
  ['variable', 'variableName'],
  ['punctuation.definition.string', 'stringPunctuation'],
  ['punctuation', 'punctuation'],
  ['markup.bold', 'strong'],
  ['markup.italic', 'emphasis'],
  ['markup.underline.link', 'link'],
  ['markup.inserted', 'inserted'],
  ['markup.deleted', 'deleted'],
  ['invalid', 'invalid'],
]

export const TOKEN_TAGS: Record<ScopeToken, Tag> = {
  comment: tags.comment,
  string: tags.string,
  regexp: tags.regexp,
  number: tags.number,
  bool: tags.bool,
  escape: tags.escape,
  character: tags.character,
  constant: tags.constant(tags.variableName),
  controlKeyword: tags.controlKeyword,
  operator: tags.operator,
  keyword: tags.keyword,
  definitionKeyword: tags.definitionKeyword,
  modifier: tags.modifier,
  function: tags.function(tags.variableName),
  typeName: tags.typeName,
  className: tags.className,
  tagName: tags.tagName,
  attributeName: tags.attributeName,
  propertyName: tags.propertyName,
  meta: tags.meta,
  heading: tags.heading,
  parameter: tags.special(tags.variableName),
  self: tags.self,
  variableName: tags.variableName,
  stringPunctuation: tags.string,
  punctuation: tags.punctuation,
  strong: tags.strong,
  emphasis: tags.emphasis,
  link: tags.link,
  inserted: tags.inserted,
  deleted: tags.deleted,
  invalid: tags.invalid,
}

/** 主题规则要染的标签：constant.language 同时染 true/false、null、atom（JSON 的 null 也跟着变色） */
export const TOKEN_TAG_LISTS: Record<ScopeToken, Tag[]> = {
  ...(Object.fromEntries(Object.entries(TOKEN_TAGS).map(([k, v]) => [k, [v]])) as Record<ScopeToken, Tag[]>),
  bool: [tags.bool, tags.null, tags.atom],
}

const TABLE = new Map<string, ScopeToken>(SCOPE_TABLE)

/** 最长前缀（按 '.' 分段）；表里没有的（包括单独的 meta.* / source.* / text.*）返回 null */
export function tokenForScope(scope: string): ScopeToken | null {
  let s = scope
  for (;;) {
    const hit = TABLE.get(s)
    if (hit) return hit
    const i = s.lastIndexOf('.')
    if (i < 0) return null
    s = s.slice(0, i)
  }
}

/** 多层作用域：最里面（最后一个）优先 */
export function tokenForScopes(scopes: readonly string[]): ScopeToken | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const token = tokenForScope(scopes[i])
    if (token) return token
  }
  return null
}

/** 主题里的选择器 → 标签：逗号分隔、丢掉带排除（` -`）的、取最后一段；是表项的严格前缀时把下面所有表项也带上 */
export function tagsForSelector(selector: string): Tag[] {
  const out = new Set<Tag>()
  for (const raw of selector.split(',')) {
    const part = raw.trim()
    if (!part || part.includes(' -')) continue
    const seg = part.split(/\s+/).pop() as string
    const token = tokenForScope(seg)
    if (token) for (const t of TOKEN_TAG_LISTS[token]) out.add(t)
    for (const [prefix, tok] of SCOPE_TABLE)
      if (prefix.startsWith(seg + '.')) for (const t of TOKEN_TAG_LISTS[tok]) out.add(t)
  }
  return [...out]
}
