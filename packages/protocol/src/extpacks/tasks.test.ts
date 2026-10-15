import { describe, expect, it } from 'vitest'
import {
  EXT_TASK_NAME_RE,
  hasAmbiguousQuantifiers,
  hasNestedQuantifier,
  hasQuantifiedAlternation,
  parseCondition,
  validateTaskTemplate,
} from './tasks'

const just = {
  id: 'just',
  label: 'Just',
  icon: 'icons/just.svg',
  files: ['justfile', 'Justfile', '.justfile'],
  extract: [
    {
      pattern: '^([A-Za-z_][A-Za-z0-9_-]*)(?:[ \\t]+[^:=\\n]*)?:(?!=)',
      flags: 'gm',
      name: 1,
      description: { commentBefore: '#' },
    },
  ],
  command: 'just {name}',
  cwd: '{dir}',
}
const maven = {
  id: 'maven',
  label: 'Maven',
  files: ['pom.xml'],
  runner: { windows: 'mvnw.cmd', default: './mvnw', fallback: 'mvn', when: 'exists:mvnw' },
  tasks: [
    { name: 'compile', description: '编译' },
    { name: 'test' },
    { name: 'package' },
    { name: 'spring-boot:run', when: 'contains:spring-boot' },
  ],
  command: '{runner} {name}',
  cwd: '{dir}',
}
const codes = (raw: unknown) => validateTaskTemplate(raw).issues.map(i => i.code)
const errors = (raw: unknown) =>
  validateTaskTemplate(raw)
    .issues.filter(i => i.severity === 'error')
    .map(i => i.code)
const with_ = (over: Record<string, unknown>) => ({ ...maven, ...over })

describe('validateTaskTemplate 正例', () => {
  it('spec §8 的 Just 和 Maven 示例零错误', () => {
    for (const t of [just, maven]) {
      const r = validateTaskTemplate(t)
      expect(r.issues.filter(i => i.severity === 'error')).toEqual([])
      expect(r.template).not.toBeNull()
    }
  })
})

describe('validateTaskTemplate 反例', () => {
  it('T1 id 写法、保留 id（gradle）', () => {
    expect(errors(with_({ id: 'Bad_Id' }))).toContain('task.id')
    expect(errors(with_({ id: 'gradle' }))).toContain('task.idReserved')
    for (const id of ['npm', 'make', 'cargo']) expect(errors(with_({ id }))).toContain('task.idReserved')
  })
  it('T2 label', () => {
    expect(errors(with_({ label: '' }))).toContain('task.label')
    expect(errors(with_({ label: { en: 'x' } }))).toContain('task.label')
    expect(errors(with_({ label: { zh: '甲', en: 'A' } }))).toEqual([])
  })
  it('T3 files 为空或含 / \\ * ?', () => {
    expect(errors(with_({ files: [] }))).toContain('task.files')
    for (const f of ['a/b', 'a\\b', '*.xml', 'a?']) expect(errors(with_({ files: [f] }))).toContain('task.files')
  })
  it('T4 内置文件名（含 Gradle）被保留', () => {
    for (const f of [
      'package.json',
      'Makefile',
      'Cargo.toml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
    ]) {
      expect(errors(with_({ files: [f] }))).toContain('task.fileReserved')
    }
    expect(errors(with_({ files: ['pom.xml'] }))).toEqual([])
  })
  it('T5 超过 200 个任务被截断并警告；非法任务名被丢弃并警告，模板仍然可用', () => {
    const many = Array.from({ length: 205 }, (_v, i) => ({ name: `t${i}` }))
    const r = validateTaskTemplate(with_({ tasks: many }))
    expect(r.template?.tasks).toHaveLength(200)
    expect(r.issues.map(i => i.code)).toContain('task.tooMany')
    const d = validateTaskTemplate(
      with_({ tasks: [{ name: 'ok' }, { name: 'bad name!' }, { name: '-x' }, { name: 'a'.repeat(81) }] }),
    )
    expect(d.template?.tasks?.map(t => t.name)).toEqual(['ok'])
    expect(d.issues.filter(i => i.code === 'task.nameDropped')).toHaveLength(3)
    expect(d.issues.every(i => i.severity === 'warning')).toBe(true)
    expect(EXT_TASK_NAME_RE.test('spring-boot:run')).toBe(true)
  })
  it('T6 tasks 和 extract 都没有', () => {
    const { tasks: _t, ...rest } = maven
    expect(errors(rest)).toContain('task.noTasks')
  })
  it('T7 正则不合法、flags 不对、name 超出分组', () => {
    const ex = (e: Record<string, unknown>) =>
      with_({ tasks: undefined, extract: [{ pattern: '^(a)', name: 1, ...e }] })
    expect(errors(ex({ pattern: '(' }))).toContain('task.extract')
    expect(errors(ex({ flags: 'gg' }))).toContain('task.extract')
    expect(errors(ex({ flags: 's' }))).toContain('task.extract')
    expect(errors(ex({ name: 0 }))).toContain('task.extract')
    expect(errors(ex({ name: 2 }))).toContain('task.extract')
    expect(errors(ex({ description: 5 }))).toContain('task.extract')
    expect(errors(ex({ description: { commentBefore: '' } }))).toContain('task.extract')
    expect(errors(ex({ flags: 'gmiu', description: 1 }))).toEqual([])
  })
  it('T8 嵌套量词是错误', () => {
    expect(errors(with_({ tasks: undefined, extract: [{ pattern: '^(a+)+$', name: 1 }] }))).toContain(
      'task.regexNested',
    )
  })
  it('T9 命令第一个词、占位符', () => {
    expect(errors(with_({ command: '{name} run' }))).toContain('task.command')
    expect(errors(with_({ command: ' mvn {name}' }))).toContain('task.command')
    expect(errors(with_({ command: '{runner} {nope}' }))).toContain('task.command')
    expect(errors(with_({ command: '{runner} {name' }))).toContain('task.command')
    expect(errors(with_({ command: 'just {name} {dir} {file}', runner: undefined }))).toEqual([])
    expect(errors(with_({ runner: undefined }))).toContain('task.command') // {runner} 但没有 runner
  })
  it('T10 runner', () => {
    expect(errors(with_({ runner: { windows: 'x.cmd' } }))).toContain('task.runner')
    expect(errors(with_({ runner: { default: 'mvn -q' } }))).toContain('task.runner')
    expect(errors(with_({ runner: { default: 'a;b' } }))).toContain('task.runner')
    expect(errors(with_({ runner: { default: './bin/tool install' } }))).toContain('task.runner')
    expect(errors(with_({ runner: { default: '/opt/x/tool arg' } }))).toContain('task.runner')
    expect(errors(with_({ runner: { default: 'C:\\Program Files\\mvn\\mvn.cmd' } }))).toEqual([])
  })
  it('T11 when 写法', () => {
    expect(errors(with_({ runner: { default: './mvnw', when: 'foo' } }))).toContain('task.when')
    expect(errors(with_({ tasks: [{ name: 'a', when: 'exists:../x' }] }))).toContain('task.when')
    expect(errors(with_({ tasks: [{ name: 'a', when: 'exists:sub/x' }] }))).toContain('task.when')
    expect(errors(with_({ tasks: [{ name: 'a', when: '!contains:x' }] }))).toEqual([])
  })
  it('T12 cwd', () => {
    expect(errors(with_({ cwd: '{dir}/..' }))).toContain('task.cwd')
    expect(errors(with_({ cwd: '{name}' }))).toContain('task.cwd')
    expect(errors(with_({ cwd: '{dir}/sub' }))).toEqual([])
  })
  it('不是对象', () => {
    expect(validateTaskTemplate(null).template).toBeNull()
    expect(codes('x')).toEqual(['task.fields'])
  })
})

describe('hasNestedQuantifier', () => {
  it.each([
    ['(a+)+', true],
    ['(a*)*', true],
    ['(?:x+y)*', true],
    ['^(\\w+\\s?)*$', true],
    ['((a+)b)*', true],
    ['(a|b+)+', true],
    ['([a-z]+)*', true],
    ['(a+){2,}', true],
    ['(a|aa)*b', false],
    ['^([A-Za-z_][A-Za-z0-9_-]*)(?:[ \\t]+[^:=\\n]*)?:(?!=)', false],
    ['(a+)?', false],
    ['(a+)', false],
    ['(ab)+', false],
    ['(?<n>a)+', false],
    ['[(a+]+', false],
    ['\\(a+\\)+', false],
    ['a+b+', false],
    ['(?:a+b)?', false],
  ] as const)('%s → %s', (pattern, expected) => {
    expect(hasNestedQuantifier(pattern)).toBe(expected)
  })
})

describe('hasQuantifiedAlternation', () => {
  it.each([
    ['^(a|aa)+$', true],
    ['(a|b)*', true],
    ['(?:x|xy){2,}', true],
    ['(a|aa)+?', true],
    ['(a|b){1,5}', true],
    ['^(a|b)?$', false],
    ['(a|b){0,1}', false],
    ['(a|aa){40}', true],
    ['(a|b){1}', false],
    ['[(|)]+', false],
    ['\\(a|b\\)+', false],
    ['^#!.*\\b(node|deno)\\b', false],
    ['(abc)+', false],
    ['((a|b)c)+', true], // 保守：内层有分支就算
    ['((a|aa))+', true],
    ['(x(a|aa))+', true],
    ['(?:(a|aa))+', true],
  ] as const)('%s → %s', (pattern, expected) => {
    expect(hasQuantifiedAlternation(pattern)).toBe(expected)
  })
})

describe('hasAmbiguousQuantifiers', () => {
  it.each([
    ['^a*a*a*a*a*a*a*a*a*a*b$', true],
    ['a*a*a*a*b', true],
    ['.*.*.*x', true],
    ['.*a.*b.*c', true],
    ['(a*){5}', true],
    ['(a+){2,100}', true],
    ['\\s*\\s*\\s*\\s*$x', true],
    ['a+b+', false],
    ['a*a*b', false],
    ['^#!.*\\bnode\\b', false],
    ['^#!.*\\b(node|deno)\\b', false],
    ['^#!.*\\bpython[\\d\\.]*\\b', false],
    ['^\\s*<\\?xml', false],
    ['^.*-\\*-\\s*mode:\\s*ruby\\s*-\\*-', false],
    ['-\\*-\\s*(mode:)?\\s*(c\\+\\+)\\s*(;|-\\*-)', false],
    ['^<\\?php', false],
    // 字符类、取反、转义、范围
    ['[ab]*[bc]*[cd]*[de]*x', true],
    ['[ab]*[cd]*[ef]*[gh]*x', false],
    ['[^a]*[^b]*[^c]*x', true],
    ['\\d*\\w*\\D*\\W*\\w*!', true],
    ['\\x41*\\u0041*A*A*b', true],
    ['[\\]a]*[\\]a]*[\\]a]*[\\]a]*b', true],
    ['a{1,3}a{1,3}a{1,3}b', false],
    ['a{0,200}a{0,200}a{0,200}a{0,200}b', true],
    ['(?=a*a*a*a*b)x', true],
    ['(?:a*)*', true],
    ['\\(a*\\(a*\\(a*\\(a*b', false],
    ['{a*{a*{a*{a*b', false],
    // 不会抛：不合法的正则也要返回布尔值
    ['(', false],
    ['a**', false],
    ['[a', false],
    ['\\', false],
  ] as const)('%s → %s', (pattern, expected) => {
    expect(hasAmbiguousQuantifiers(pattern)).toBe(expected)
  })
  it('超长的模式也很快', () => {
    const t = Date.now()
    expect(hasAmbiguousQuantifiers('(?:a|b)'.repeat(5000) + 'c*')).toBe(false)
    expect(hasAmbiguousQuantifiers('('.repeat(20000))).toBeTypeOf('boolean')
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('parseCondition', () => {
  it('解析 contains / exists / 取反', () => {
    expect(parseCondition('contains:spring-boot')).toEqual({ negate: false, kind: 'contains', value: 'spring-boot' })
    expect(parseCondition('!exists:mvnw')).toEqual({ negate: true, kind: 'exists', value: 'mvnw' })
    expect(parseCondition('contains:a:b')?.value).toBe('a:b')
  })
  it.each(['', 'contains:', 'has:x', 'exists', '!!exists:x', ' contains:x'])('拒绝 %j', c => {
    expect(parseCondition(c)).toBeNull()
  })
})
