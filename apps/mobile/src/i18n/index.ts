// 界面语言（docs/mobile-remote.md §25）：跟随系统（默认）/ 中文 / English，存在本机。
// 每处文字写成成对的 L('中文', 'English')，不会漏翻；带数字的用模板字符串，两边各写一句。
// 换语言时 main.tsx 按 useLang() 重新挂整个界面，所以在渲染时调用 L 就够了；模块加载时就算好的文字（常量表）要写成函数或 getter。
// 不翻的：AI 的回复、文件内容、Git 输出、电脑传回来的错误原文和会话里的提示（由电脑那边的语言决定）。
import { useSyncExternalStore } from 'react'

export type Lang = 'zh' | 'en'
export type LangPreference = 'system' | Lang

const KEY = 'pixelsky.mobile.lang'
/** service worker 读不到 localStorage：语言另存一份到 Cache Storage，推送通知的文字用它（public/sw.js） */
const SW_CACHE = 'pixelsky-prefs'
const SW_KEY = './lang'

function stored(): LangPreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'zh' || v === 'en' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 系统语言：中文（含繁体）用中文，其余都用英文 */
export function systemLang(
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Lang {
  const first = languages[0] ?? (typeof navigator === 'undefined' ? '' : navigator.language) ?? ''
  return /^zh\b/i.test(first) ? 'zh' : 'en'
}

// 演示模式截图用：?lang=zh|en 盖过设置（只在 vite dev 里，同 features/me/theme.ts 的 ?theme=）
const forced = (): Lang | null => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  const v = new URLSearchParams(location.search).get('lang')
  return v === 'zh' || v === 'en' ? v : null
}

const resolve = (pref: LangPreference): Lang => forced() ?? (pref === 'system' ? systemLang() : pref)

// 测试里固定中文（断言都按中文写的），不跟运行测试的电脑的系统语言走
let pref: LangPreference = import.meta.env.MODE === 'test' ? 'zh' : stored()
let current: Lang = resolve(pref)
const listeners = new Set<() => void>()

/** 当前界面语言 */
export const lang = (): Lang => current

/** 成对的文字：按当前语言取一句 */
export const L = (zh: string, en: string): string => (current === 'en' ? en : zh)

export const langPreference = (): LangPreference => pref

export function setLangPreference(next: LangPreference): void {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // 无痕模式存不了：这次打开有效
  }
  apply()
}

/** 把当前语言写到 <html lang>、manifest 和 service worker 能读到的地方；变了就通知界面重挂 */
export function apply(): void {
  const before = current
  current = resolve(pref)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
    document.title = L('像素星空', 'PixelSky')
    // 添加到主屏幕时用的名字跟着语言（manifest.en.webmanifest 是英文名那份）
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (manifest)
      manifest.href = manifest.href.replace(
        /manifest(\.en)?\.webmanifest/,
        current === 'en' ? 'manifest.en.webmanifest' : 'manifest.webmanifest',
      )
  }
  if (typeof caches !== 'undefined')
    void caches
      .open(SW_CACHE)
      .then(c => c.put(SW_KEY, new Response(current)))
      .catch(() => undefined)
  if (before !== current) for (const l of listeners) l()
}

/** 界面根上用：语言变了重新渲染（main.tsx 拿它当 key 重挂整个界面） */
export function useLang(): Lang {
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** 系统语言变了（跟随系统时）：重新算 */
if (typeof window !== 'undefined') window.addEventListener('languagechange', () => pref === 'system' && apply())
