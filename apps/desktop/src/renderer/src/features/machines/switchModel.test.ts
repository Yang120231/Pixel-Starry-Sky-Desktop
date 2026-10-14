import { describe, expect, it } from 'vitest'
import type { MachineInfo, MachineState } from '../../../../shared/types/machines'
import { cloudMachines, switchView } from './switchModel'

const machine = (id: string, status: MachineInfo['status'], name = id): MachineInfo => ({
  id,
  kind: id === 'local' ? 'local' : id.startsWith('wsl-') ? 'wsl' : 'ssh',
  name,
  host: id === 'local' ? '' : 'h',
  port: 22,
  username: 'u',
  auth: id === 'local' ? 'local' : 'agent',
  hasSecret: false,
  status,
  error: null,
  fingerprint: null,
  platform: null,
  home: null,
})
const local = machine('local', 'local')
const state = (currentId: string, ...others: MachineInfo[]): MachineState => ({
  currentId,
  machines: [local, ...others],
})

describe('switchView', () => {
  it('当前是本机', () => {
    expect(switchView(state('local', machine('ssh-1', 'connected')))).toEqual({ side: 'local', warn: false })
  })
  it('远程已连接', () => {
    expect(switchView(state('ssh-1', machine('ssh-1', 'connected', 'dev-server')))).toEqual({
      side: 'cloud',
      name: 'dev-server',
      warn: false,
    })
  })
  it.each(['disconnected', 'error', 'connecting'] as const)('远程 %s 时带警告点', status => {
    expect(switchView(state('ssh-1', machine('ssh-1', status, 'gpu-box')))).toEqual({
      side: 'cloud',
      name: 'gpu-box',
      warn: true,
    })
  })
  it('没有远程机器', () => {
    expect(switchView(state('local'))).toEqual({ side: 'local', warn: false })
  })
  it('当前是 WSL 发行版：本机这一边，带发行版名', () => {
    expect(switchView(state('wsl-aaaaaaaaaaaa', machine('wsl-aaaaaaaaaaaa', 'connected', 'Ubuntu')))).toEqual({
      side: 'local',
      name: 'Ubuntu',
      warn: false,
    })
  })
  it('WSL 发行版没连上时带警告点', () => {
    expect(switchView(state('wsl-aaaaaaaaaaaa', machine('wsl-aaaaaaaaaaaa', 'error', 'Debian'))).warn).toBe(true)
  })
  it('当前机器不在列表里时当本机', () => {
    expect(switchView(state('ssh-9')).side).toBe('local')
  })
})

describe('cloudMachines', () => {
  it('不含本机', () => {
    const a = machine('ssh-1', 'connected'),
      b = machine('ssh-2', 'disconnected')
    expect(cloudMachines(state('local', a, b))).toEqual([a, b])
    expect(cloudMachines(state('local'))).toEqual([])
  })
  it('不含 WSL 发行版', () => {
    const a = machine('ssh-1', 'connected')
    expect(cloudMachines(state('local', a, machine('wsl-bbbbbbbbbbbb', 'disconnected')))).toEqual([a])
  })
})
