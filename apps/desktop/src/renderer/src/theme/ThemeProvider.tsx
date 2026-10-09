import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { hasWallpaper } from '@/appearance/wallpaper'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemo } from '@/mock/data'
import { PANE_FOCUS_MOTION_KEY, readPaneFocusMotion, type PaneFocusMotion } from './paneFocusMotion'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
/** 动画：始终开启 / 跟随系统 / 关闭（docs/ui/settings.md §3.1） */
export type MotionPreference = 'on' | 'system' | 'off'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  motion: MotionPreference
  setMotion: (motion: MotionPreference) => void
  paneFocusMotion: PaneFocusMotion
  setPaneFocusMotion: (motion: PaneFocusMotion) => void
  /** 系统是否要求减少动态效果（Windows「动画效果」关闭时为 true） */
  systemReducedMotion: boolean
}

const STORAGE_KEY = 'pixelsky.theme'
const MOTION_KEY = 'pixelsky.motion'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // localStorage 不可用时使用默认值
  }
  return 'system'
}

function readMotion(): MotionPreference {
  try {
    const value = localStorage.getItem(MOTION_KEY)
    if (value === 'on' || value === 'system' || value === 'off') return value
  } catch {
    // localStorage 不可用时使用默认值
  }
  return 'on'
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 忽略
  }
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 外观偏好：主题（浅色 / 深色 / 跟随系统）和动画（始终开启 / 跟随系统 / 关闭）。
 *  规则见 docs/ui/design-tokens.md §5、docs/ui/settings.md */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useI18n()
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  const [motion, setMotionState] = useState<MotionPreference>(readMotion)
  const [paneFocusMotion, setPaneFocusMotionState] = useState<PaneFocusMotion>(readPaneFocusMotion)
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia(REDUCED_MOTION).matches)

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION)
    const onChange = () => setSystemReducedMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // globals.css 按 data-motion 决定是否关闭动画
  useEffect(() => {
    document.documentElement.dataset.motion = motion
  }, [motion])
  useEffect(() => {
    document.documentElement.dataset.paneFocus = paneFocusMotion
  }, [paneFocusMotion])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = preference === 'system' ? system : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    window.pixelsky?.setTheme(resolved, hasWallpaper())
  }, [resolved])

  // 截图模式（src/main/index.ts）通过这个钩子切换主题
  useEffect(() => {
    window.__pixelskySetTheme = (theme) => setPreferenceState(theme)
    return () => {
      delete window.__pixelskySetTheme
    }
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        setPreferenceState(next)
        save(STORAGE_KEY, next)
      },
      motion,
      setMotion: (next) => {
        setMotionState(next)
        save(MOTION_KEY, next)
      },
      systemReducedMotion,
      paneFocusMotion,
      setPaneFocusMotion: (next) => {
        setPaneFocusMotionState(next)
        if (!isDemo) save(PANE_FOCUS_MOTION_KEY, next)
      },
    }),
    [preference, resolved, motion, systemReducedMotion, paneFocusMotion],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error(tr("theme.ThemeProvider.message1043"))
  return value
}
