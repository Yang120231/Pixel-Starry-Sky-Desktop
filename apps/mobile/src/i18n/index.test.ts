import { afterEach, describe, expect, it } from 'vitest'
import { L, lang, setLangPreference, systemLang } from './index'

describe('界面语言', () => {
  afterEach(() => setLangPreference('zh'))

  it('系统语言是中文（含繁体）才用中文，其余用英文', () => {
    expect(systemLang(['zh-CN', 'en'])).toBe('zh')
    expect(systemLang(['zh-Hant-TW'])).toBe('zh')
    expect(systemLang(['en-US', 'zh-CN'])).toBe('en')
    expect(systemLang(['ja'])).toBe('en')
  })

  it('测试里默认中文；切到英文后 L 取英文那句', () => {
    expect(lang()).toBe('zh')
    expect(L('保存', 'Save')).toBe('保存')
    setLangPreference('en')
    expect(lang()).toBe('en')
    expect(L('保存', 'Save')).toBe('Save')
  })
})
