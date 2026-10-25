import { tr } from '@/i18n/core'

/** 把设计变量解析成具体颜色：var() 在网页里没有定义，注入脚本要的是算好的值 */
function resolved(prop: 'color' | 'fontFamily', value: string): string {
  const probe = document.createElement('span')
  probe.style[prop] = value
  document.body.appendChild(probe)
  const out = getComputedStyle(probe)[prop]
  probe.remove()
  return out
}

/** 开 / 关选取时传给主进程的配置：当前主题的颜色和小框文案（主进程再校验，网页读不到界面的任何东西） */
export function pickConfig(): { theme: Record<string, string>; text: Record<string, string> } {
  const color = (name: string) => resolved('color', `var(${name})`)
  return {
    theme: {
      accent: color('--accent'),
      onAccent: color('--accent-on'),
      popover: color('--bg-popover'),
      surface: color('--bg-surface'),
      text: color('--text'),
      muted: color('--text-muted'),
      border: color('--border-card'),
      mono: resolved('fontFamily', 'var(--font-mono)'),
    },
    text: {
      hint: tr('projectTools.pick.hint'),
      title: tr('projectTools.pick.title'),
      placeholder: tr('projectTools.pick.placeholder'),
      cancel: tr('projectTools.pick.cancel'),
      add: tr('projectTools.pick.add'),
      auto: tr('projectTools.pick.auto'),
      route: tr('projectTools.pick.route'),
      selector: tr('projectTools.pick.selector'),
      element: tr('projectTools.pick.element'),
      shot: tr('projectTools.pick.shot'),
    },
  }
}
