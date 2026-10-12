// 添加到主屏幕的步骤页（docs/mobile-remote.md §20）：浏览器不能直接弹安装框时（iPhone、微信里、没触发安装事件的安卓），
// 按当前浏览器写几步手动操作；也把「添加之后能怎样、不能怎样」说清楚。
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { detectInstallEnv, type InstallEnv } from '@/platform/installEnv'
import { Button, Screen, Section } from '@/ui'

const STEPS: Record<InstallEnv, { title: string; steps: string[]; copy?: boolean }> = {
  'ios-safari': {
    title: 'iPhone / iPad 的 Safari',
    steps: [
      '点浏览器的「分享」按钮（iPhone 在屏幕底部，新版 iOS 收在右下角「⋯」里；iPad 在右上角）',
      '往下翻，点「添加到主屏幕」',
      '点右上角「添加」',
    ],
  },
  'ios-other': {
    title: '换 Safari 打开',
    steps: [
      '苹果设备上只有 Safari 能把网页添加到主屏幕，这个浏览器不行',
      '点下面的「复制网址」，在 Safari 里粘贴打开',
      '再点 Safari 的「分享」›「添加到主屏幕」›「添加」',
    ],
    copy: true,
  },
  wechat: {
    title: '先用浏览器打开',
    steps: [
      '微信 / QQ 里没有「添加到主屏幕」，先点右上角的「⋯」，选「在浏览器打开」（iPhone 选「在 Safari 中打开」）',
      '在浏览器里再回到这一页，按那个浏览器的步骤添加：iPhone 点「分享」›「添加到主屏幕」，安卓点「⋮」›「添加到主屏幕」',
    ],
    copy: true,
  },
  'android-chrome': {
    title: '安卓的 Chrome',
    steps: ['点右上角的「⋮」', '选「添加到主屏幕」或「安装应用」', '确认「安装」或「添加」'],
  },
  'android-other': {
    title: '安卓的浏览器',
    steps: [
      '打开浏览器的菜单（通常是右上角或底部的「⋮」「≡」）',
      '找「添加到主屏幕」或「安装应用」，点一下确认',
      '找不到的话，换 Chrome 打开这个网址再试',
    ],
    copy: true,
  },
  desktop: {
    title: '电脑的浏览器',
    steps: [
      'Chrome / Edge：点地址栏右边的「安装」图标，或菜单里的「安装像素星空」',
      'Mac 的 Safari：菜单栏「文件」›「添加到程序坞」',
    ],
  },
}

export function AddToHome({ onBack }: { onBack(): void }) {
  const env = detectInstallEnv(navigator.userAgent, navigator.maxTouchPoints)
  const { title, steps, copy } = STEPS[env]
  const [copied, setCopied] = useState(false)
  const copyUrl = () =>
    // 不带 # 后面的内容（配对链接的数据在那里）
    navigator.clipboard
      ?.writeText(location.origin + location.pathname)
      .then(() => setCopied(true))
      .catch(() => undefined)

  return (
    <Screen title="添加到主屏幕" onBack={onBack}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 py-4">
        <Section title={title}>
          <ol className="flex list-decimal flex-col gap-2 py-3.5 pr-4 pl-9 text-prose text-fg">
            {steps.map(s => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Section>
        {copy && (
          <div className="px-4">
            <Button variant="secondary" onClick={() => void copyUrl()} className="w-full">
              <Copy size={18} /> {copied ? '已复制' : '复制网址'}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3 px-5 text-meta text-fg-muted">
          <p>
            添加后从桌面图标打开，像 App 一样全屏，没有地址栏
            {env.startsWith('ios') || env === 'wechat'
              ? '；配对也不会因为久不打开被 Safari 清掉（Safari 连续 7 天没打开过网页，会清掉网页存的数据）。'
              : '。'}
          </p>
          <p className="text-fg-secondary">
            后台提醒仍然收不到：网页切到后台就会被浏览器暂停，连接断了。要提醒请用安卓 App，或者回到页面查看。
          </p>
        </div>
      </div>
    </Screen>
  )
}
