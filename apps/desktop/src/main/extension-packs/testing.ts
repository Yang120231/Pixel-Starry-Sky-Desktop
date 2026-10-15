import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 测试用：临时目录放在仓库的 scratch/ 下，afterEach 里统一清掉 */
const SCRATCH = join(__dirname, '../../../../../scratch')
const made: string[] = []

export function tempDir(prefix = 'extpacks-'): string {
  mkdirSync(SCRATCH, { recursive: true })
  const dir = mkdtempSync(join(SCRATCH, prefix))
  made.push(dir)
  return dir
}

export function cleanTemp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export const FIXTURES = join(__dirname, '__fixtures__')

/** 把 __fixtures__/<name> 复制成 <into>/<as ?? name>，返回目标目录 */
export function copyFixture(name: string, into: string, as: string = name): string {
  const target = join(into, as)
  cpSync(join(FIXTURES, name), target, { recursive: true })
  return target
}
