import { FILE_STAGE_CHUNK_BYTES, MAX_STAGED_FILE_BYTES } from '@pixelsky/protocol'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { tr } from '@/i18n/core'

const base64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)))
  return btoa(binary)
}

export interface StageOptions {
  /** 每传完一块报一次：已传的字节数 */
  onProgress?: (sent: number) => void
  /** 取消：停在下一块之前，删掉半截文件，抛 AbortError */
  signal?: AbortSignal
}

const aborted = (): DOMException => new DOMException(tr('composer.file.uploadCancelled'), 'AbortError')

/**
 * 输入框自己传上去、还没发出去的暂存副本（按路径记在本机，重启后也认）。只有这些移除附件时才删：
 * 分叉、回退、撤回放回输入框的附件指向原消息的副本，原消息还要读，删了就成了悬空引用
 */
const OWNED_KEY = 'pixelsky-staged-owned'
const OWNED_LIMIT = 200
function owned(): string[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(OWNED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
function saveOwned(list: string[]): void {
  try {
    globalThis.localStorage?.setItem(OWNED_KEY, JSON.stringify(list.slice(-OWNED_LIMIT)))
  } catch {
    // 存不了：最坏是移除附件时不删副本，30 天后照样清理
  }
}

/** 消息发出去了：这些副本归消息所有，之后从别处（分叉的草稿等）移除都不删 */
export function releaseStaged(paths: readonly string[]): void {
  if (!paths.length) return
  const gone = new Set(paths)
  saveOwned(owned().filter(p => !gone.has(p)))
}

/** 将文件分块传到当前工作区所属机器的私有临时路径。 */
export async function stageFile(file: File, ref: WorkspaceRef, options: StageOptions = {}): Promise<string> {
  if (file.size > MAX_STAGED_FILE_BYTES) throw new Error(tr('composer.file.remoteTooLarge', { p0: file.name }))
  const files = window.pixelsky?.files
  if (!files) throw new Error(tr('composer.file.stageUnavailable'))
  const { onProgress, signal } = options
  if (signal?.aborted) throw aborted()
  const id = crypto.randomUUID()
  let begun = false
  try {
    await files.stage(ref, { action: 'begin', id, name: file.name || 'attachment', bytes: file.size })
    begun = true
    for (let offset = 0; offset < file.size; offset += FILE_STAGE_CHUNK_BYTES) {
      if (signal?.aborted) throw aborted()
      const end = Math.min(file.size, offset + FILE_STAGE_CHUNK_BYTES)
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      await files.stage(ref, { action: 'chunk', id, offset, dataBase64: base64(bytes) })
      onProgress?.(end)
    }
    if (signal?.aborted) throw aborted()
    const result = await files.stage(ref, { action: 'finish', id })
    if (!result.path) throw new Error(tr('composer.file.stageUnavailable'))
    saveOwned([...owned().filter(p => p !== result.path), result.path])
    return result.path
  } catch (error) {
    if (begun) await files.stage(ref, { action: 'cancel', id }).catch(() => undefined)
    throw error
  }
}

/**
 * 从输入框移除附件时删掉它的暂存副本：只删输入框自己传的、还没发出去的（见 owned）；
 * 删不掉（机器断开）不报错，30 天后照样清理
 */
export async function discardStaged(path: string, ref: WorkspaceRef | null): Promise<void> {
  if (!ref) return
  const list = owned()
  if (!list.includes(path)) return
  saveOwned(list.filter(p => p !== path))
  await window.pixelsky?.files.stage(ref, { action: 'remove', path }).catch(() => undefined)
}
