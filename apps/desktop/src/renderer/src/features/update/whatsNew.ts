// 更新后的「更新内容」（GitHub #13，docs/release-update.md §8）：说明就是发布时写的 .github/release-notes/v<版本>.md，
// 打包进界面，不用联网。跳过了几个版本时，把中间每一版的说明都列出来（新的在前）。
import { useSyncExternalStore } from 'react'
import { isNewerVersion } from '@pixelsky/protocol'
import type { WhatsNew, WhatsNewState } from '../../../../shared/types/app-info'

const files = import.meta.glob<string>('../../../../../../../.github/release-notes/v*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

export interface VersionNotes {
  version: string
  text: string
}

/** 文件名 → 版本号（v0.2.1-beta.md → 0.2.1-beta） */
export const RELEASE_NOTES: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path.replace(/^.*\/v(.+)\.md$/, '$1'), text.trim()]),
)

/** 版本 a 比 b 新：先按数字比，数字一样时正式版比测试版新、再按后缀比 */
function newer(a: string, b: string): boolean {
  if (isNewerVersion(a, b)) return true
  if (isNewerVersion(b, a)) return false
  const sa = a.split('-').slice(1).join('-'),
    sb = b.split('-').slice(1).join('-')
  if (!sa || !sb) return !sa && !!sb
  return sa.localeCompare(sb, 'en', { numeric: true }) > 0
}

/** 这次要列哪几版的说明：比上次运行的新、不比当前新；不知道上次是哪版时只列当前这版 */
export function notesFor(
  { version, previous }: WhatsNew,
  notes: Record<string, string> = RELEASE_NOTES,
): VersionNotes[] {
  const versions = Object.keys(notes).filter(v => (previous ? newer(v, previous) && !newer(v, version) : v === version))
  return versions.sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0)).map(v => ({ version: v, text: notes[v] }))
}

// ---- 状态：启动时问一次主进程；关于页能手动再打开 ----

let state: { open: WhatsNew | null; muted: boolean } = { open: null, muted: false }
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(listener => listener())
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
let started = false

export function startWhatsNew(): void {
  if (started || !window.pixelsky?.app) return
  started = true
  void window.pixelsky.app.whatsNew().then(
    (s: WhatsNewState) => {
      // 这一版没写说明（例如自己打的包）就不弹，也记成看过
      const open = s.pending && notesFor(s.pending).length ? s.pending : null
      if (s.pending && !open) void window.pixelsky?.app.setWhatsNew({ seen: true })
      state = { open, muted: s.muted }
      emit()
    },
    () => undefined,
  )
}

export const whatsNewActions = {
  /** 关于页「本版更新内容」 */
  show(version: string): void {
    state = { ...state, open: { version, previous: null } }
    emit()
  },
  /** 关掉弹窗：这一版记成看过；mute 为 true 时以后不再弹 */
  close(mute = false): void {
    state = { open: null, muted: mute || state.muted }
    emit()
    void window.pixelsky?.app.setWhatsNew(mute ? { seen: true, muted: true } : { seen: true })
  },
  setMuted(muted: boolean): void {
    state = { ...state, muted }
    emit()
    void window.pixelsky?.app.setWhatsNew({ muted })
  },
}

export const useWhatsNew = () => useSyncExternalStore(subscribe, () => state)
