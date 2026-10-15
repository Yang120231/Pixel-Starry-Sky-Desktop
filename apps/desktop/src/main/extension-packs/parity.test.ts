// 桌面加载器与共享用例的一致性（plan §7 runner D）：
// 每个文件夹用例物化成真实目录，loadPack 的 issues / status / inactive / skills 必须等于用例的 dev 期望。
import { afterEach, describe, expect, it } from 'vitest'
import { canSymlink, expectOf, listCases, materializeFolder, normalizeIssues } from '@pixelsky/extension-cli/testing'
import { loadPack } from './loader'
import { cleanTemp, tempDir } from './testing'

afterEach(cleanTemp)

const cases = listCases().filter(c => c.input === 'folder')

describe('桌面加载器与共享用例一致（folder / dev）', () => {
  it('至少有一批文件夹用例', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const c of cases) {
    it(`${c.name}：${c.title}`, async () => {
      const dir = tempDir()
      if (c.needs?.includes('symlink') && !canSymlink(dir)) return // Windows 没有权限时跳过
      const expected = expectOf(c)?.dev
      expect(expected, `${c.name} 缺少 dev 期望（先用 CORPUS_UPDATE=1 生成）`).toBeTruthy()
      const root = materializeFolder(c, dir)
      const pack = await loadPack({
        key: 'f-parity',
        root,
        source: 'folder',
        enabled: true,
        addedAt: 1,
        options: {},
        revision: 1,
        appVersion: c.appVersion ?? '0.4.1-beta',
      })
      expect(pack.info.status).toBe(expected!.status)
      expect(pack.info.inactive).toEqual(expected!.inactive)
      expect(pack.info.skills.map(s => ({ name: s.name, index: s.index }))).toEqual(expected!.skills)
      expect(normalizeIssues(pack.info.issues, false)).toEqual(expected!.issues)
    })
  }
})
