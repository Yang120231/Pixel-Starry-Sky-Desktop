import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { validateFiles, validateImages, type FileAttachment, type ImageAttachment } from '@pixelsky/protocol'
import { tr, type TranslationKey } from '@/i18n/core'

type Draft<T> = { items: T[]; loading: boolean; error: string | null }

/** 输入框里还没发出去的附件，按输入框保存在 IndexedDB（图片、文本文件各一个库） */
function draftStore<T>(
  name: string,
  validate: (value: unknown) => T[],
  errors: Record<'save' | 'restore', TranslationKey>,
) {
  const drafts = new Map<string, Draft<T>>()
  const listeners = new Set<() => void>()
  const saves = new Map<string, Promise<void>>()
  const loads = new Map<string, Promise<void>>()
  const empty: Draft<T> = { items: [], loading: true, error: null }
  const emit = (): void => listeners.forEach(listener => listener())
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  let database: Promise<IDBDatabase> | null = null
  function db(): Promise<IDBDatabase> {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('drafts')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        database = null
        reject(request.error)
      }
    })
    return database
  }
  async function hydrateOnce(key: string): Promise<void> {
    drafts.set(key, empty)
    try {
      const database = await db()
      const items = await new Promise<T[]>((resolve, reject) => {
        const request = database.transaction('drafts').objectStore('drafts').get(key)
        request.onsuccess = () => {
          try {
            resolve(validate(request.result))
          } catch (error) {
            reject(error)
          }
        }
        request.onerror = () => reject(request.error)
      })
      drafts.set(key, { items, loading: false, error: null })
    } catch {
      drafts.set(key, { items: [], loading: false, error: tr(errors.restore) })
    }
    emit()
  }
  function hydrate(key: string): Promise<void> {
    const loading = loads.get(key)
    if (loading) return loading
    if (drafts.has(key)) return Promise.resolve()
    const work = hydrateOnce(key).finally(() => loads.delete(key))
    loads.set(key, work)
    return work
  }
  /** 这个输入框已经加了附件（只看已经读进来的草稿：可见的输入框都读过） */
  const has = (key: string): boolean => (drafts.get(key)?.items.length ?? 0) > 0

  async function update(key: string, change: (previous: T[]) => T[]): Promise<void> {
    await hydrate(key)
    const next = validate(change(drafts.get(key)?.items ?? []))
    drafts.set(key, { items: next, loading: false, error: null })
    emit()
    const previous = saves.get(key) ?? Promise.resolve()
    const save = previous
      .catch(() => undefined)
      .then(async () => {
        const database = await db()
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction('drafts', 'readwrite'),
            store = tx.objectStore('drafts')
          if (next.length) store.put(next, key)
          else store.delete(key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      })
    saves.set(key, save)
    try {
      await save
    } catch {
      drafts.set(key, { ...drafts.get(key)!, error: tr(errors.save) })
      emit()
      throw new Error(tr(errors.save))
    } finally {
      if (saves.get(key) === save) saves.delete(key)
    }
  }
  function useDraft(key: string) {
    const state = useSyncExternalStore(subscribe, () => drafts.get(key) ?? empty)
    useEffect(() => {
      void hydrate(key)
    }, [key])
    const change = useCallback((fn: (previous: T[]) => T[]) => update(key, fn), [key])
    return { ...state, update: change }
  }
  return { has, update, useDraft }
}

const images = draftStore<ImageAttachment>('pixelsky-image-drafts', validateImages, {
  save: 'composer.attachment.saveError',
  restore: 'composer.attachment.restoreError',
})
const files = draftStore<FileAttachment>('pixelsky-file-drafts', validateFiles, {
  save: 'composer.file.saveError',
  restore: 'composer.file.restoreError',
})

/** 这个输入框已经加了图片或文件 */
export const hasAttachmentDraft = (key: string): boolean => images.has(key) || files.has(key)
export const updateImages = images.update
export const updateFiles = files.update
export function useImageDraft(key: string) {
  const { items, ...rest } = images.useDraft(key)
  return { ...rest, images: items }
}
export function useFileDraft(key: string) {
  const { items, ...rest } = files.useDraft(key)
  return { ...rest, files: items }
}
