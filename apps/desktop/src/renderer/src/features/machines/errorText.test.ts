import { describe, expect, it } from 'vitest'
import { machineErrorText } from './errorText'
import { machineErrors } from '../../../../shared/i18n/machineMessages'

describe('machineErrorText', () => {
  it('错误码按当前语言取 machineErrors 的文案', () => {
    expect(machineErrorText(new Error('SSH_MACHINE_MISSING'), 'zh-CN')).toBe(machineErrors.SSH_MACHINE_MISSING.zh)
    expect(machineErrorText('WSL_NOT_READY', 'en-US')).toBe(machineErrors.WSL_NOT_READY.en)
  })

  it('不认识的照 translateMessage 处理，原样返回普通文字', () => {
    expect(machineErrorText(new Error('something else'), 'zh-CN')).toBe('something else')
  })
})
