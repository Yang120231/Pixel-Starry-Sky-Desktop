/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// renderer 的目录约束（docs/ARCHITECTURE.md「renderer 目录」、docs/restructure.md §9）
const root = __dirname
const TOP = ['app', 'features', 'ui', 'data', 'mock', 'i18n', 'styles', 'main.tsx', 'env.d.ts', 'architecture.test.ts']

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const rel = (file: string): string => relative(root, file).split(sep).join('/')
const files = walk(root)
  .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map(rel)

interface Dep {
  target: string
  typeOnly: boolean
}

/** 文件里指向 renderer/src 内部的导入（静态、动态、`import type`），目标是相对 renderer/src 的路径 */
function deps(file: string): Dep[] {
  const text = readFileSync(join(root, file), 'utf8')
  const out: Dep[] = []
  const pattern = /(?:^import\s+(type\s+)?[^'"]*?from\s+|^export\s+[^'"]*?from\s+|^import\s+|import\()\s*'([^']+)'/gm
  for (const m of text.matchAll(pattern)) {
    const spec = m[2]
    let target: string
    if (spec.startsWith('@/')) target = spec.slice(2)
    else if (spec.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(file), spec))
    else continue
    if (target.startsWith('..')) continue
    out.push({ target, typeOnly: !!m[1] })
  }
  return out
}
const area = (path: string): string => path.split('/')[0]

describe('renderer structure', () => {
  it('only has the agreed top-level entries', () => {
    const extra = readdirSync(root).filter(name => !TOP.includes(name))
    expect(extra).toEqual([])
    expect(files.length).toBeGreaterThan(200)
  })

  it('loads mock/ only from main.tsx', () => {
    const found = files
      .filter(file => area(file) !== 'mock' && file !== 'main.tsx')
      .flatMap(file =>
        deps(file)
          .filter(d => area(d.target) === 'mock')
          .map(d => `${file} -> ${d.target}`),
      )
    expect(found).toEqual([])
  })

  it('keeps ui/ free of app/ and features/', () => {
    const found = files
      .filter(file => area(file) === 'ui')
      .flatMap(file =>
        deps(file)
          .filter(d => ['app', 'features', 'mock'].includes(area(d.target)))
          .map(d => `${file} -> ${d.target}`),
      )
    expect(found).toEqual([])
  })

  it('keeps data/ free of value imports from app/, features/ and mock/', () => {
    const found = files
      .filter(file => area(file) === 'data')
      .flatMap(file =>
        deps(file)
          .filter(d => !d.typeOnly && ['app', 'features', 'mock'].includes(area(d.target)))
          .map(d => `${file} -> ${d.target}`),
      )
    expect(found).toEqual([])
  })

  it('keeps features/ from importing the app shell', () => {
    const found = files
      .filter(file => area(file) === 'features')
      .flatMap(file =>
        deps(file)
          .filter(d => !d.typeOnly && area(d.target) === 'app')
          .map(d => `${file} -> ${d.target}`),
      )
    expect(found).toEqual([])
  })
})
