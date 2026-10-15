import { describe, expect, it } from 'vitest'
import { tags } from '@lezer/highlight'
import { TOKEN_TAGS, tagsForSelector, tokenForScope, tokenForScopes } from './scopes'

describe('tokenForScope', () => {
  it('最长前缀', () => {
    expect(tokenForScope('keyword.control.flow')).toBe('controlKeyword')
    expect(tokenForScope('keyword.other.x')).toBe('keyword')
    expect(tokenForScope('support.type.property-name.json')).toBe('propertyName')
    expect(tokenForScope('variable.other.property.dotenv')).toBe('propertyName')
    expect(tokenForScope('variable.other.readwrite')).toBe('variableName')
    expect(tokenForScope('constant.character.escape.x')).toBe('escape')
  })
  it('表里没有的是 null', () => {
    expect(tokenForScope('meta.block')).toBeNull()
    expect(tokenForScope('source.js')).toBeNull()
    expect(tokenForScope('text.html')).toBeNull()
  })
  it('注解是 meta', () => {
    expect(tokenForScope('meta.decorator.python')).toBe('meta')
  })
  it('多层作用域：最里面的优先', () => {
    expect(tokenForScopes(['source.ts', 'string.quoted', 'meta.block'])).toBe('string')
    expect(tokenForScopes(['source.ts'])).toBeNull()
  })
})

describe('tagsForSelector', () => {
  it('entity.name 带上函数、类型、类、标签、小节', () => {
    const t = tagsForSelector('entity.name')
    for (const tag of [
      TOKEN_TAGS.function,
      TOKEN_TAGS.typeName,
      TOKEN_TAGS.className,
      TOKEN_TAGS.tagName,
      TOKEN_TAGS.heading,
    ])
      expect(t).toContain(tag)
  })
  it('取最后一段，丢掉排除项，逗号分隔', () => {
    expect(tagsForSelector('source.js keyword')).toContain(TOKEN_TAGS.keyword)
    expect(tagsForSelector('string -comment')).toEqual([])
    const both = tagsForSelector('comment, string')
    expect(both).toContain(tags.comment)
    expect(both).toContain(tags.string)
  })
  it('constant.language 同时染 bool / null / atom', () => {
    const t = tagsForSelector('constant.language.null')
    expect(t).toContain(tags.bool)
    expect(t).toContain(tags.null)
    expect(t).toContain(tags.atom)
  })
})
