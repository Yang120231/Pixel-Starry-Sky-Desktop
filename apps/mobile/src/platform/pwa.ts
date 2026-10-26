// 网页版的「添加到主屏幕」（docs/mobile-remote.md §20）：manifest 和图标在 public/，这里是运行时的两件事——
// 1. 提前接住浏览器的 beforeinstallprompt（Chrome / Edge 在页面加载早期就发，React 还没挂上就错过了），点按钮时直接弹系统的安装框；
// 2. 注册只管「没网时显示离线页」的 service worker（public/sw.js）。
import { useSyncExternalStore } from 'react'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

/** 已经是从主屏幕图标打开的（独立窗口，没有地址栏）：安卓 / 桌面看 display-mode，iOS Safari 看 navigator.standalone */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** 在 main.tsx 里、渲染 React 之前调用一次 */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault() // 不要浏览器自己的迷你提示条，由「设置」里的入口触发
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

/** 浏览器能直接弹安装框就弹；返回用户是否点了安装。弹过一次的事件作废，之后改走手动步骤 */
export async function promptInstall(): Promise<boolean> {
  const event = deferred
  if (!event) return false
  deferred = null
  emit()
  try {
    await event.prompt()
    return (await event.userChoice).outcome === 'accepted'
  } catch {
    return false
  }
}

/** 0 = 不显示入口（App 里、已经从主屏幕打开、刚装好）；1 = 显示，点开看步骤；2 = 显示，点了直接弹系统安装框 */
function snapshot(): 0 | 1 | 2 {
  if (installed || isStandalone()) return 0
  return deferred ? 2 : 1
}

export function useInstallEntry(): 0 | 1 | 2 {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    snapshot,
    () => 0,
  )
}

/**
 * 注册离线页的 service worker。只在网页版的正式构建里、https（或 localhost）下注册；失败只写控制台，不影响使用。
 * updateViaCache: 'none'：sw.js 自己也不走 HTTP 缓存，改了离线页后能很快更新。
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !window.isSecureContext || !('serviceWorker' in navigator)) return
  const base = import.meta.env.BASE_URL
  // 等页面加载完再注册，不和首屏抢网络
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .catch(e => console.warn('离线页没注册上（不影响使用）', e))
  })
}
