import { tr } from '../../i18n/core'
import { useEffect, useSyncExternalStore } from 'react'

interface RetrySettingsState {
  maxRetries: number | null
  loading: boolean
  saving: boolean
  error: string | null
}
let state: RetrySettingsState = { maxRetries: null, loading: true, saving: false, error: null }
const listeners = new Set<() => void>()
let started = false,
  revision = 0
function set(patch: Partial<RetrySettingsState>): void {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}
function start(): void {
  if (started) return
  started = true
  const bridge = window.pixelsky?.engine
  if (!bridge) {
    set({
      loading: false,
      get error() {
        return tr('settings.requestRetry.configureRequestRetriesIn')
      },
    })
    return
  }
  bridge.onEvent(e => {
    if (e.kind === 'retry_settings') {
      revision++
      set({ maxRetries: e.settings.maxRetries, loading: false, error: null })
    }
  })
  const requested = revision
  void bridge
    .retrySettings()
    .then(s => {
      if (revision === requested) set({ ...s, loading: false })
    })
    .catch(e => {
      if (revision === requested) set({ loading: false, error: (e as Error).message })
    })
}
export async function saveRequestRetry(maxRetries: number | null): Promise<void> {
  if (state.saving) return
  const bridge = window.pixelsky?.engine
  if (!bridge) return
  set({ saving: true, error: null })
  try {
    const saved = await bridge.setRetrySettings(maxRetries)
    revision++
    set({ ...saved, loading: false })
  } catch (e) {
    set({ error: (e as Error).message })
  } finally {
    set({ saving: false })
  }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function useRequestRetry(): RetrySettingsState {
  useEffect(start, [])
  return useSyncExternalStore(subscribe, () => state)
}
