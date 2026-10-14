import { describe, expect, it } from 'vitest'
import {
  addToGroup,
  arrangeProjects,
  createGroup,
  dissolveGroup,
  groupOf,
  rangeBetween,
  removeFromGroups,
  renameGroup,
} from './projectGroups'

const projects = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
const groups = [
  { id: 'g1', name: '像素星空', projects: ['d', 'b'] },
  { id: 'g2', name: '别的机器', projects: ['x'] },
]

describe('侧栏分区排列', () => {
  it('分区在前、组内按项目列表的顺序，其余项目在后；一个都不在列表里的分区不显示', () => {
    expect(arrangeProjects(projects, groups)).toEqual([
      { kind: 'group', group: groups[0], projects: [{ id: 'b' }, { id: 'd' }] },
      { kind: 'project', project: { id: 'a' } },
      { kind: 'project', project: { id: 'c' } },
      { kind: 'project', project: { id: 'e' } },
    ])
  })

  it('同一个项目只算在第一个分区里', () => {
    const twice = [...groups, { id: 'g3', name: '重复', projects: ['b'] }]
    expect(arrangeProjects(projects, twice).filter(e => e.kind === 'group')).toHaveLength(1)
  })

  it('找项目在哪个分区', () => {
    expect(groupOf(groups, 'd')?.id).toBe('g1')
    expect(groupOf(groups, 'a')).toBeUndefined()
  })
})

describe('分区增删改', () => {
  it('新建分区放最后，项目从原来的分区移出，空分区去掉', () => {
    expect(createGroup(groups, { id: 'g3', name: '新' }, ['b', 'd', 'a', 'a'])).toEqual([
      { id: 'g2', name: '别的机器', projects: ['x'] },
      { id: 'g3', name: '新', projects: ['b', 'd', 'a'] },
    ])
  })

  it('加入已有分区接在后面；分区不存在时不变', () => {
    expect(addToGroup(groups, 'g2', ['b'])).toEqual([
      { id: 'g1', name: '像素星空', projects: ['d'] },
      { id: 'g2', name: '别的机器', projects: ['x', 'b'] },
    ])
    expect(addToGroup(groups, 'nope', ['a'])).toEqual(groups)
  })

  it('移出、改名、解散', () => {
    expect(removeFromGroups(groups, ['x'])).toEqual([groups[0]])
    expect(renameGroup(groups, 'g1', '客户')[0].name).toBe('客户')
    expect(dissolveGroup(groups, 'g1')).toEqual([groups[1]])
  })
})

describe('Shift 连选', () => {
  const order = ['a', 'b', 'c', 'd']
  it('两头都算，方向不限', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(order, 'd', 'a')).toEqual(order)
  })
  it('没有起点或起点不在列表里只选这一个', () => {
    expect(rangeBetween(order, null, 'c')).toEqual(['c'])
    expect(rangeBetween(order, 'zz', 'c')).toEqual(['c'])
    expect(rangeBetween(order, 'a', 'zz')).toEqual([])
  })
})
