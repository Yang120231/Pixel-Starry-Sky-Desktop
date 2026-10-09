import { describe, expect, it } from 'vitest'
import { codedError, parseCodedError, replaceCodedErrors } from '../src/errors'

describe('coded host errors', () => {
  it('round-trips code and params through the error message', () => {
    const error = codedError('files.exists', { name: 'a.ts', count: 2 })
    expect(parseCodedError(error.message)).toEqual({ code: 'files.exists', params: { name: 'a.ts', count: 2 } })
    expect(parseCodedError(codedError('files.notFound').message)).toEqual({ code: 'files.notFound', params: {} })
  })
  it('ignores plain messages and broken payloads', () => {
    expect(parseCodedError('文件路径超出项目')).toBeNull()
    expect(parseCodedError('PIXELSKY_ERR:{oops')).toBeNull()
    expect(parseCodedError('PIXELSKY_ERR:{"params":{}}')).toBeNull()
  })
  it('replaces coded fragments inside a wrapped message', () => {
    const wrapped = '启动失败：' + codedError('terminal.scriptNotFound', { name: 'dev' }).message
    expect(replaceCodedErrors(wrapped, ({ code, params }) => `${code}/${params.name}`)).toBe(
      '启动失败：terminal.scriptNotFound/dev',
    )
    expect(replaceCodedErrors('没有代码', () => 'x')).toBe('没有代码')
  })
})
