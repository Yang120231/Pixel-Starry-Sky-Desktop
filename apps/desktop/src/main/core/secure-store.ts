// 通用的加密存储（docs/ui/custom-api.md §4.2）：一个文件，按 id 存若干字符串值，整份用系统加密写盘。
// 系统加密不可用时只放内存、不写明文；解不开的旧文件留着并备份，不覆盖成空的
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Cipher {
  available(): boolean
  encrypt(text: string): string
  decrypt(text: string): string
}

export class SecureStore {
  private data: Record<string, Record<string, string>> = {}
  warning: string | null = null
  private unreadable = false

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {
    if (existsSync(file) && cipher.available())
      try {
        const parsed: unknown = JSON.parse(cipher.decrypt(readFileSync(file, 'utf8')))
        if (parsed && typeof parsed === 'object') this.data = parsed as Record<string, Record<string, string>>
      } catch {
        this.warning = '已有凭据无法解密，请重新填写；原加密文件保留。'
        this.unreadable = true
      }
  }

  get persistent(): boolean {
    return this.cipher.available()
  }

  get(id: string): Readonly<Record<string, string>> | undefined {
    return this.data[id]
  }

  set(id: string, values: Record<string, string>): void {
    this.data[id] = { ...values }
    this.save()
  }

  remove(id: string): void {
    if (!(id in this.data)) return
    delete this.data[id]
    this.save()
  }

  private save(): void {
    if (!this.persistent) return
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = this.file + '.tmp'
    if (this.unreadable && existsSync(this.file)) {
      copyFileSync(this.file, this.file + '.unreadable-' + Date.now() + '.bak')
      this.unreadable = false
    }
    if (Object.keys(this.data).length === 0 && !existsSync(this.file)) return
    writeFileSync(temp, this.cipher.encrypt(JSON.stringify(this.data)), { mode: 0o600 })
    try {
      renameSync(temp, this.file)
    } catch (err) {
      rmSync(temp, { force: true })
      throw err
    }
  }
}
