import { describe, expect, it } from 'vitest'
import type { AddProjectsResult, ProjectRecord } from '@pixelsky/protocol'
import { addProjectsInBatches } from './projectImportBatches'

const project = (path: string): ProjectRecord => ({ id: path, name: path, path, addedAt: 1 })
describe('bulk project registration', () => {
  it('splits more than 500 projects and combines the results in order', async () => {
    const paths = Array.from({ length: 1001 }, (_, i) => `/project-${i}`)
    const sizes: number[] = []
    const result = await addProjectsInBatches(paths, async batch => {
      sizes.push(batch.length)
      return { added: batch.map(project), existing: [], failed: [] }
    })
    expect(sizes).toEqual([500, 500, 1])
    expect(result.added.map(p => p.path)).toEqual(paths)
  })
  it('keeps successful and existing projects, records failures and continues after a batch error', async () => {
    const paths = Array.from({ length: 1001 }, (_, i) => `/project-${i}`)
    let calls = 0
    const result = await addProjectsInBatches(paths, async batch => {
      calls++
      if (calls === 2) throw new Error('batch unavailable')
      const result: AddProjectsResult = { added: batch.map(project), existing: [], failed: [] }
      if (calls === 1) {
        result.existing.push(result.added.shift()!)
        result.failed.push({ path: result.added.pop()!.path, error: 'missing' })
      }
      return result
    })
    expect(calls).toBe(3)
    expect(result.added).toHaveLength(499)
    expect(result.existing.map(p => p.path)).toEqual([paths[0]])
    expect(result.failed).toHaveLength(501)
    expect(result.added.at(-1)?.path).toBe(paths[1000])
  })
})
