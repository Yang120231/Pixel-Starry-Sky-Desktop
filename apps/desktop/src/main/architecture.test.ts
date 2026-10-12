import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 主进程的结构约束（docs/restructure.md §8.4）：模块之间不用 `export let` 接线，值导入没有循环。
// `import type` 不算依赖（编译后不存在）。
const mainDir = fileURLToPath(new URL('.', import.meta.url))
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const files = walk(mainDir).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
const name = (file: string): string => relative(mainDir, file).replace(/\\/g, '/')

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const deps: string[] = []
  for (const m of text.matchAll(/^import\s+(type\s+)?[^'"]*?from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue
    const base = resolve(dirname(file), m[2])
    const target = [base + '.ts', join(base, 'index.ts')].find(existsSync)
    if (target) deps.push(target)
  }
  return deps
}

describe('main process structure', () => {
  it('has no `export let` wiring between modules', () => {
    const found = files.flatMap(file =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => /^export let\b/.test(line))
        .map(line => `${name(file)}: ${line}`),
    )
    expect(found).toEqual([])
  })

  it('has no value-import cycles', () => {
    const graph = new Map(files.map(file => [file, imports(file)]))
    const cycles: string[] = []
    const seen = new Set<string>(),
      stack: string[] = [],
      onStack = new Set<string>()
    const visit = (file: string): void => {
      seen.add(file)
      stack.push(file)
      onStack.add(file)
      for (const dep of graph.get(file) ?? []) {
        if (onStack.has(dep)) cycles.push(stack.slice(stack.indexOf(dep)).map(name).join(' -> '))
        else if (!seen.has(dep)) visit(dep)
      }
      stack.pop()
      onStack.delete(file)
    }
    for (const file of files) if (!seen.has(file)) visit(file)
    expect(graph.size).toBeGreaterThan(40)
    expect(cycles).toEqual([])
  })

  // shared/ 是主进程和渲染层共用的纯代码（类型、文案、频道的 @ 解析），不算应用层
  it('keeps core free of electron and of the app layer', () => {
    for (const file of files.filter(f => name(f).startsWith('core/'))) {
      const text = readFileSync(file, 'utf8')
      expect(text, name(file)).not.toMatch(/from 'electron'/)
      for (const dep of imports(file))
        expect(name(dep), `${name(file)} imports ${name(dep)}`).toMatch(/^(core|\.\.\/shared)\//)
    }
  })
})
