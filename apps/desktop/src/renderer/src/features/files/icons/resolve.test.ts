import { describe, expect, it } from 'vitest'
import { buildIconIndex, mergePartial, resolveFileIcon, resolveFolderIcon } from './resolve'

const src = { packKey: 'b-1', revision: 3, themePath: 'theme/icons.json' }
const theme = {
  iconDefinitions: {
    file: { iconPath: './../icons/file.svg' },
    ts: { iconPath: './../icons/ts.svg' },
    dts: { iconPath: './../icons/dts.svg' },
    npm: { iconPath: './../icons/npm.svg' },
    py: { iconPath: './../icons/py.svg' },
    md: { iconPath: './../icons/md.svg' },
    mdLight: { iconPath: './../icons/md_light.svg' },
    folder: { iconPath: './../icons/folder.svg' },
    folderOpen: { iconPath: './../icons/folder-open.svg' },
    folderSrc: { iconPath: './../icons/folder-src.svg' },
    folderSrcOpen: { iconPath: './../icons/folder-src-open.svg' },
    root: { iconPath: './../icons/root.svg' },
    rootOpen: { iconPath: './../icons/root-open.svg' },
    font: { fontCharacter: '\E001' },
    escape: { iconPath: './../../../etc/passwd.svg' },
    exe: { iconPath: './../icons/a.exe' },
  },
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folderOpen',
  rootFolder: 'root',
  rootFolderExpanded: 'rootOpen',
  fileNames: { 'package.json': 'npm', 'bad.txt': 'font', 'bad2.txt': 'escape', 'bad3.txt': 'exe' },
  fileExtensions: { ts: 'ts', 'd.ts': 'dts', md: 'md' },
  languageIds: { python: 'py' },
  folderNames: { src: 'folderSrc' },
  folderNamesExpanded: { src: 'folderSrcOpen' },
  light: { fileExtensions: { md: 'mdLight' } },
}
const { index, issues } = buildIconIndex(theme, src)
const file = (name: string, o: { light?: boolean; languageId?: string | null } = {}) =>
  resolveFileIcon(index, name, { light: o.light ?? false, languageId: o.languageId ?? null })?.path ?? null
const folder = (name: string, o: { light?: boolean; expanded?: boolean; root?: boolean } = {}) =>
  resolveFolderIcon(index, name, { light: o.light ?? false, expanded: o.expanded ?? false, root: o.root })?.path ?? null

describe('文件图标查找', () => {
  it('完整文件名优先，不分大小写', () => {
    expect(file('package.json')).toBe('icons/npm.svg')
    expect(file('Package.JSON')).toBe('icons/npm.svg')
  })
  it('扩展名从长到短：d.ts 先于 ts', () => {
    expect(file('a.d.ts')).toBe('icons/dts.svg')
    expect(file('a.b.ts')).toBe('icons/ts.svg')
  })
  it('认不出扩展名时按语言 id，再退回默认文件图标', () => {
    expect(file('script', { languageId: 'python' })).toBe('icons/py.svg')
    expect(file('whatever.xyz')).toBe('icons/file.svg')
  })
  it('浅色覆盖项优先，没有的沿用深色', () => {
    expect(file('a.md', { light: true })).toBe('icons/md_light.svg')
    expect(file('a.md')).toBe('icons/md.svg')
    expect(file('a.ts', { light: true })).toBe('icons/ts.svg')
  })
  it('图标带上来源扩展和版本', () => {
    expect(resolveFileIcon(index, 'a.ts', { light: false, languageId: null })).toEqual({
      packKey: 'b-1',
      revision: 3,
      path: 'icons/ts.svg',
    })
  })
})

describe('文件夹图标查找', () => {
  it('按名字，展开 / 合起分开', () => {
    expect(folder('src')).toBe('icons/folder-src.svg')
    expect(folder('src', { expanded: true })).toBe('icons/folder-src-open.svg')
    expect(folder('other')).toBe('icons/folder.svg')
    expect(folder('other', { expanded: true })).toBe('icons/folder-open.svg')
  })
  it('根文件夹用 rootFolder(Expanded)', () => {
    expect(folder('proj', { root: true })).toBe('icons/root.svg')
    expect(folder('proj', { root: true, expanded: true })).toBe('icons/root-open.svg')
  })
  it('没有根图标的主题，根行退回普通文件夹图标', () => {
    const t = buildIconIndex({ iconDefinitions: { f: { iconPath: 'f.svg' } }, folder: 'f' }, src).index
    expect(resolveFolderIcon(t, 'x', { light: false, expanded: false, root: true })?.path).toBe('theme/f.svg')
  })
})

describe('丢弃无效定义', () => {
  it('字体图标、逃出目录、非 svg/png 的定义不进索引并记入 issues', () => {
    expect(file('bad.txt')).toBe('icons/file.svg')
    expect(file('bad2.txt')).toBe('icons/file.svg')
    expect(file('bad3.txt')).toBe('icons/file.svg')
    expect(issues).toHaveLength(3)
  })
  it('不是对象的主题给出空索引', () => {
    const r = buildIconIndex('x', src)
    expect(r.issues).toHaveLength(1)
    expect(resolveFileIcon(r.index, 'a.ts', { light: false, languageId: null })).toBeNull()
  })
})

describe('局部主题叠加', () => {
  it('覆盖同名项，保留其余，不改底板', () => {
    const partial = buildIconIndex(
      { iconDefinitions: { x: { iconPath: 'x.svg' } }, fileExtensions: { ts: 'x', rs: 'x' } },
      { packKey: 'f-2', revision: 1, themePath: 'icons.json' },
    ).index
    const merged = mergePartial(index, partial)
    expect(resolveFileIcon(merged, 'a.ts', { light: false, languageId: null })?.packKey).toBe('f-2')
    expect(resolveFileIcon(merged, 'a.rs', { light: false, languageId: null })?.path).toBe('x.svg')
    expect(resolveFileIcon(merged, 'a.md', { light: false, languageId: null })?.path).toBe('icons/md.svg')
    expect(resolveFileIcon(index, 'a.ts', { light: false, languageId: null })?.packKey).toBe('b-1')
  })
})
