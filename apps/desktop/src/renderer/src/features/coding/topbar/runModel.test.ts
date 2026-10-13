import { describe, expect, it } from 'vitest'
import { primaryService, serviceActions, type RunStatus } from './runModel'

const svc = (id: string, status: RunStatus): { id: string; status: RunStatus } => ({ id, status })

describe('primaryService', () => {
  it('空列表是 null', () => {
    expect(primaryService([])).toBeNull()
  })
  it('优先运行中，其次 starting，否则第一个', () => {
    expect(primaryService([svc('a', 'stopped'), svc('b', 'starting'), svc('c', 'running')])?.id).toBe('c')
    expect(primaryService([svc('a', 'stopped'), svc('b', 'starting')])?.id).toBe('b')
    expect(primaryService([svc('a', 'failed'), svc('b', 'stopped')])?.id).toBe('a')
  })
})

describe('serviceActions', () => {
  it('stopped 和 failed 能启动', () => {
    expect(serviceActions('stopped')).toEqual({ start: true, stop: false, restart: false })
    expect(serviceActions('failed')).toEqual({ start: true, stop: false, restart: false })
  })
  it('running 能停止和重启', () => {
    expect(serviceActions('running')).toEqual({ start: false, stop: true, restart: true })
  })
  it('starting 和 stopping 都不能点', () => {
    for (const s of ['starting', 'stopping'] as const)
      expect(serviceActions(s)).toEqual({ start: false, stop: false, restart: false })
  })
})
