import { describe, expect, it } from 'vitest'
import { argumentMachine, machineOf, remoteIds, remoteArguments } from './identity'
const machine = 'ssh-11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
describe('machine resource ownership', () => {
  it('keeps identical remote and local resources distinct without rewriting user content', () => {
    const raw = { record: { id, projectId: id, engineSessionId: id }, input: { id }, text: id, content: [{ id }], output: { id } }
    const encoded = remoteIds(raw, machine, true)
    expect(encoded.record.id).toBe(machine + '~' + id)
    expect(encoded.input).toEqual(raw.input); expect(encoded.content).toEqual(raw.content)
    expect(encoded.record.engineSessionId).toBe(id); expect(encoded.text).toBe(id)
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
    expect(remoteIds([{ id: value, text: value, input: { sessionId: value } }], machine, false)).toEqual([{ id, text: value, input: { sessionId: value } }])
    expect(remoteIds([value], machine, false)).toEqual([id])
    expect(remoteIds(value, 'ssh-other', false)).toBe(value)
    expect(remoteArguments('engine:send', [value, value], machine)).toEqual([id, value])
    expect(remoteArguments('engine:renameSession', [value, value], machine)).toEqual([id, value])
    expect(remoteArguments('engine:answer', [value, value, { type: 'deny' }], machine)).toEqual([id, id, { type: 'deny' }])
  })
})
