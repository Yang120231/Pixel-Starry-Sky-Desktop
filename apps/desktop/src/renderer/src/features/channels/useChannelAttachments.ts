// 频道输入框的附件（本机频道）：粘贴、拖进来、点回形针选的图片和文本文件，规则照会话输入框
// （features/session/Composer.tsx 的 addFiles / addImages）；草稿按频道存在 IndexedDB
import { useRef, useState } from 'react'
import { MAX_FILE_BYTES, MAX_FILE_COUNT, MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { readImage } from '@/features/session/attachments/images'
import { needsConversion } from '@/features/session/attachments/convertImage'
import { isImageFile, readTextFile } from '@/features/session/attachments/files'
import { updateFiles, updateImages, useFileDraft, useImageDraft } from '@/features/session/attachments/drafts'

/** 剪贴板 / 拖进来的东西里的文件；文件夹不收（频道不支持 @路径） */
export function transferFiles(transfer: DataTransfer): File[] {
  const items = [...transfer.items].filter(item => item.kind === 'file')
  if (!items.length) return [...transfer.files]
  return items.flatMap(item => {
    const file = item.getAsFile()
    return file && !item.webkitGetAsEntry()?.isDirectory ? [file] : []
  })
}

export function useChannelAttachments(key: string) {
  const imageDraft = useImageDraft(key),
    fileDraft = useFileDraft(key)
  const { images } = imageDraft,
    { files } = fileDraft
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(0)
  const queue = useRef(Promise.resolve())

  /** 读附件排队进行，读的时候不能发送 */
  const read = (work: () => Promise<void>): void => {
    setReading(n => n + 1)
    queue.current = queue.current.then(async () => {
      try {
        await work()
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setReading(n => n - 1)
      }
    })
  }

  const addImages = (list: File[]): void => {
    if (!list.length) return
    if (images.length + list.length > MAX_IMAGE_COUNT) {
      setError(tr('composer.attachment.tooMany'))
      return
    }
    // 要转成 PNG 的（BMP 这类）原文件大小不算数，转完再算
    const already = images.reduce((sum, image) => sum + image.bytes, 0)
    if (already + list.reduce((sum, file) => sum + (needsConversion(file) ? 0 : file.size), 0) > MAX_IMAGE_TOTAL) {
      setError(tr('composer.attachment.totalTooLarge'))
      return
    }
    read(async () => {
      const results = await Promise.allSettled(list.map(readImage))
      const loaded = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
      if (already + loaded.reduce((sum, image) => sum + image.bytes, 0) > MAX_IMAGE_TOTAL)
        throw new Error(tr('composer.attachment.totalTooLarge'))
      if (loaded.length) await updateImages(key, current => [...current, ...loaded])
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
    })
  }

  /** 图片走图片附件，其余按文本文件读 */
  const add = (list: FileList | File[]): void => {
    const all = [...list]
    addImages(all.filter(isImageFile))
    const others = all.filter(file => !isImageFile(file))
    if (!others.length) return
    if (files.length + others.length > MAX_FILE_COUNT) {
      setError(tr('composer.file.tooMany'))
      return
    }
    const large = others.find(file => file.size > MAX_FILE_BYTES)
    if (large) {
      setError(tr('composer.file.tooLarge', { p0: large.name }))
      return
    }
    read(async () => {
      const results = await Promise.allSettled(others.map(readTextFile))
      const loaded = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
      if (loaded.length) await updateFiles(key, current => [...current, ...loaded])
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
    })
  }

  return {
    images,
    files,
    error: error ?? imageDraft.error ?? fileDraft.error,
    busy: reading > 0 || imageDraft.loading || fileDraft.loading,
    add,
    removeImage: (id: string) => void updateImages(key, list => list.filter(i => i.id !== id)).catch(() => {}),
    replaceImage: (id: string, next: (typeof images)[number]) =>
      void updateImages(key, list => list.map(i => (i.id === id ? next : i))).catch(() => {}),
    removeFile: (id: string) => void updateFiles(key, list => list.filter(f => f.id !== id)).catch(() => {}),
    /** 发出去了：只去掉发出去的那些（发送途中又加的留着） */
    clear: async (sent: { images: readonly { id: string }[]; files: readonly { id: string }[] }): Promise<void> => {
      const images = new Set(sent.images.map(i => i.id)),
        files = new Set(sent.files.map(f => f.id))
      await Promise.all([
        updateImages(key, list => list.filter(i => !images.has(i.id))),
        updateFiles(key, list => list.filter(f => !files.has(f.id))),
      ])
      setError(null)
    },
    dismissError: () => setError(null),
  }
}
