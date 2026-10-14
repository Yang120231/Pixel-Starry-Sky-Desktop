import { describe, expect, it } from 'vitest'
import { argumentMachine, machineOf, remoteIds, remoteArguments } from './identity'
const machine = 'ssh-11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
describe('machine resource ownership', () => {
  it('encodes wsl resource ids both ways and keeps them apart from ssh', () => {
    const wsl = 'wsl-33333333-3333-4333-8333-333333333333'
    expect(remoteIds({ id }, wsl, true)).toEqual({ id: wsl + '~' + id })
    expect(remoteIds({ id: wsl + '~' + id }, wsl, false)).toEqual({ id })
    expect(remoteIds({ id: wsl + '~' + id }, machine, false)).toEqual({ id: wsl + '~' + id })
    expect(remoteIds({ id: machine + '~' + id }, wsl, false)).toEqual({ id: machine + '~' + id })
    expect(machineOf(wsl + '~' + id)).toBe(wsl)
    expect(argumentMachine([{ projectId: wsl + '~' + id }])).toBe(wsl)
  })
  it('keeps identical remote and local resources distinct without rewriting user content', () => {
    const raw = {
      record: { id, projectId: id, engineSessionId: id },
      input: { id },
      text: id,
      content: [{ id }],
      output: { id },
    }
    const encoded = remoteIds(raw, machine, true)
    expect(encoded.record.id).toBe(machine + '~' + id)
    expect(encoded.input).toEqual(raw.input)
    expect(encoded.content).toEqual(raw.content)
    expect(encoded.record.engineSessionId).toBe(id)
    expect(encoded.text).toBe(id)
    expect(remoteIds(encoded, machine, false)).toEqual(raw)
  })
  it('routes references by ownership even after another machine is selected', () => {
    expect(argumentMachine([{ projectId: machine + '~' + id }])).toBe(machine)
    expect(argumentMachine([machine + '~' + id, 'hello'])).toBe(machine)
    expect(argumentMachine([{ projectId: id }])).toBeNull()
    expect(machineOf(id)).toBe('local')
  })
  it('preserves literal content that happens to equal a resource id', () => {
    const value = machine + '~' + id
    expect(remoteIds([{ id: value, text: value, input: { sessionId: value } }], machine, false)).toEqual([
      { id, text: value, input: { sessionId: value } },
    ])
    expect(remoteIds([value], machine, false)).toEqual([id])
    expect(remoteIds(value, 'ssh-other', false)).toBe(value)
    expect(remoteArguments('engine:send', [value, value], machine)).toEqual([id, value])
    expect(remoteArguments('engine:renameSession', [value, value], machine)).toEqual([id, value])
    expect(remoteArguments('engine:answer', [value, value, { type: 'deny' }], machine)).toEqual([
      id,
      id,
      { type: 'deny' },
    ])
  })
  it('does not route free text that merely starts with a machine prefix', () => {
    expect(argumentMachine([machine + '~hello', null])).toBeNull()
    expect(argumentMachine([machine + '~' + id + ' extra', null])).toBeNull()
    expect(argumentMachine([machine + '~', null])).toBeNull()
    expect(argumentMachine([machine + '~' + id, null])).toBe(machine)
  })
  it('only encodes uuid values in resource fields', () => {
    expect(remoteIds({ id: 'not-a-uuid', sessionId: id, other: id }, machine, true)).toEqual({
      id: 'not-a-uuid',
      sessionId: machine + '~' + id,
      other: id,
    })
    expect(remoteIds({ ids: [id, 'x'] }, machine, true)).toEqual({ ids: [machine + '~' + id, 'x'] })
    expect(remoteIds({ ids: [machine + '~' + id] }, machine, false)).toEqual({ ids: [id] })
    expect(remoteIds(null, machine, true)).toBeNull()
  })
  it('routes object arguments by sessionId, projectId, then id', () => {
    expect(argumentMachine([{ sessionId: machine + '~' + id }])).toBe(machine)
    expect(argumentMachine([{ id: machine + '~' + id }])).toBe(machine)
    expect(argumentMachine([{ other: machine + '~' + id }])).toBeNull()
    expect(argumentMachine([])).toBeNull()
    expect(argumentMachine([42])).toBeNull()
  })
  it('decodes only declared positional resource parameters', () => {
    const value = machine + '~' + id
    expect(remoteArguments('projectTools:searchTasks', [value, value], machine)).toEqual([value, id])
    expect(remoteArguments('engine:steerQueued', [value, value, value, value], machine)).toEqual([id, id, id, value])
    expect(remoteArguments('engine:cancelQueued', [value, value], machine)).toEqual([id, id])
    expect(remoteArguments('x', [{ projectId: value, input: { id: value } }], machine)).toEqual([
      { projectId: id, input: { id: value } },
    ])
  })
})
