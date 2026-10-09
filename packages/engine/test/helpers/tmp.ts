// 测试临时目录：固定放在仓库根 scratch/<日期>-engine-test/ 下，和运行目录无关
import { mkdirSync, mkdtempSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// test/helpers → test → packages/engine → packages → 仓库根
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本次测试共用的父目录 */
export function scratchRoot(): string {
  const dir = join(REPO_ROOT, 'scratch', `${today()}-engine-test`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 新建一个临时目录，返回路径；用完调用 removeTmp */
export function makeTmp(prefix: string): string {
  return mkdtempSync(join(scratchRoot(), `${prefix}-`))
}

export function removeTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  // 父目录空了就一起删掉，不在 scratch/ 留空目录
  try {
    rmdirSync(dirname(dir))
  } catch {
    /* 还有其他测试的目录 */
  }
}
