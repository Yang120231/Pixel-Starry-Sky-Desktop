import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { validateImages, type ImageAttachment } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

type ImageDraft = { images: ImageAttachment[]; loading: boolean; error: string | null }
const drafts = new Map<string, ImageDraft>()
const listeners = new Set<() => void>()
const saves = new Map<string, Promise<void>>()
const loads = new Map<string, Promise<void>>()
const empty: ImageDraft = { images: [], loading: true, error: null }
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
    const request = indexedDB.open('pixelsky-image-drafts', 1)
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
    const images = await new Promise<ImageAttachment[]>((resolve, reject) => {
      const request = database.transaction('drafts').objectStore('drafts').get(key)
      request.onsuccess = () => {
        try {
          resolve(validateImages(request.result))
        } catch (error) {
          reject(error)
        }
      }
      request.onerror = () => reject(request.error)
    })
    drafts.set(key, { images, loading: false, error: null })
  } catch {
    drafts.set(key, { images: [], loading: false, error: tr('composer.attachment.restoreError') })
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
/** 这个输入框已经加了图片（只看已经读进来的草稿：可见的输入框都读过） */
export const hasImageDraft = (key: string): boolean => (drafts.get(key)?.images.length ?? 0) > 0

export async function updateImages(
  key: string,
  update: (previous: ImageAttachment[]) => ImageAttachment[],
): Promise<void> {
  await hydrate(key)
  const next = validateImages(update(drafts.get(key)?.images ?? []))
  drafts.set(key, { images: next, loading: false, error: null })
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
    drafts.set(key, { ...drafts.get(key)!, error: tr('composer.attachment.saveError') })
    emit()
    throw new Error(tr('composer.attachment.saveError'))
  } finally {
    if (saves.get(key) === save) saves.delete(key)
  }
}
export function useImageDraft(key: string) {
  const state = useSyncExternalStore(subscribe, () => drafts.get(key) ?? empty)
  useEffect(() => {
    void hydrate(key)
  }, [key])
  const update = useCallback((fn: (previous: ImageAttachment[]) => ImageAttachment[]) => updateImages(key, fn), [key])
  return { ...state, update }
}
