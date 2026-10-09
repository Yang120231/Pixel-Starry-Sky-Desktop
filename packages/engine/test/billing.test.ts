import { describe, expect, it } from 'vitest'
import type { PlatformCharge, TurnUsage } from '@pixelsky/protocol'
import { settleUsage } from '../src/billing'

const original: TurnUsage = {
  durationMs: 200,
  models: { model: { input: 42, output: 8, cacheRead: 0, cacheWrite: 0, costUsd: 9 } },
  settlement: {
    account: 'alice',
    startedAt: 1000,
    complete: false,
    requests: [
      { id: 'a', model: 'model', groupId: '7' },
      { id: 'b', model: 'model', groupId: '7' },
    ],
  },
}
const charge = (requestId: string, extra: Partial<PlatformCharge> = {}): PlatformCharge => ({
  requestId,
  groupId: '7',
  model: 'upstream-alias',
  billing: 'subscription',
  costUsd: 0.0034,
  rateMultiplier: 0.2,
  input: 10,
  output: 5,
  cacheRead: 90,
  cacheWrite: 2,
  ...extra,
})
describe('authoritative platform settlement', () => {
  it('does not use estimates while pending or unavailable, and rejects wrong groups and unknown IDs', () => {
    expect(settleUsage(original, [], false).models.model).toMatchObject({ costUsd: null, costSource: 'pending' })
    const result = settleUsage(original, [charge('other'), charge('a', { groupId: '8' })], true)
    expect(result.models.model).toMatchObject({ costUsd: null, costSource: 'unavailable' })
    expect(result.settlement?.complete).toBe(false)
  })
  it('deduplicates retries and uses actual zero/multiplied charges exactly once, preserving requested model identity', () => {
    const result = settleUsage(original, [charge('a'), charge('a'), charge('b', { costUsd: 0 })], true)
    expect(result.models.model).toMatchObject({
      costUsd: 0.0034,
      costSource: 'platform',
      billing: 'subscription',
      requests: 2,
      input: 20,
      output: 10,
      cacheRead: 180,
    })
    expect(result.settlement?.complete).toBe(true)
    expect(original.models.model.costUsd).toBe(9)
  })
  it('does not invent a charge for missing requests or invalid server values', () => {
    expect(settleUsage(original, [charge('a'), charge('b', { costUsd: NaN })], true).models.model.costUsd).toBeNull()
    expect(
      settleUsage({ ...original, settlement: { ...original.settlement!, requests: [] } }, [], true).models.model
        .costUsd,
    ).toBeNull()
  })
})
