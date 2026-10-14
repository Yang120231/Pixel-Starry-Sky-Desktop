import { beforeEach, describe, expect, it } from 'vitest'
import { codingLayout, getCodingLayout, getKeepLeft, reportCodingFit } from './layoutStore'

const hidden = (leftHiddenByFit: boolean): void => reportCodingFit({ leftHiddenByFit })

describe('layoutStore keepLeft', () => {
  beforeEach(() => {
    hidden(false)
    codingLayout.setOpen('left', false)
    codingLayout.setOpen('left', true)
    codingLayout.setOpen('left', false)
  })

  it('关左栏清掉 keepLeft，主动打开设上', () => {
    codingLayout.showLeft('files')
    expect(getKeepLeft()).toBe(true)
    codingLayout.setOpen('left', false)
    expect(getKeepLeft()).toBe(false)
    expect(getCodingLayout().left.open).toBe(false)
  })

  it('布局藏了左栏（回报后）：点开关不关偏好，改设 keepLeft', () => {
    codingLayout.showLeft('files')
    hidden(true)
    codingLayout.toggle('left')
    expect(getCodingLayout().left.open).toBe(true)
    expect(getKeepLeft()).toBe(true)
    hidden(false)
    codingLayout.toggleLeft('files') // 现在看得见了，再点就是收起
    expect(getCodingLayout().left.open).toBe(false)
    expect(getKeepLeft()).toBe(false)
  })

  it('布局藏了左栏时 toggleLeft 当前视图 = 我要看；换视图照常切换', () => {
    codingLayout.showLeft('files')
    hidden(true)
    codingLayout.toggleLeft('files')
    expect(getCodingLayout().left).toMatchObject({ open: true, view: 'files' })
    expect(getKeepLeft()).toBe(true)
    codingLayout.toggleLeft('git')
    expect(getCodingLayout().left).toMatchObject({ open: true, view: 'git' })
  })
})
