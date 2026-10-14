// 这台电脑的设备 id（docs/ui/channels-phase-c.md §9.1）：认领团队任务时用，同一个账号开了两台电脑只有一台能认领成功。
// 随机生成一次，存在 <频道目录>/device.json。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ID = /^[A-Za-z0-9-]{8,64}$/

export async function loadDeviceId(dir: string): Promise<string> {
  const file = join(dir, 'device.json')
  try {
    const saved = (JSON.parse(await readFile(file, 'utf8')) as { id?: unknown }).id
    if (typeof saved === 'string' && ID.test(saved)) return saved
  } catch {
    /* 第一次，或文件坏了：重新生成 */
  }
  const id = `dev-${randomUUID()}`
  await mkdir(dir, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ id }), 'utf8')
  await rename(temp, file)
  return id
}
