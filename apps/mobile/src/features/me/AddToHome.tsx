// 添加到主屏幕的步骤页（docs/mobile-remote.md §20）：浏览器不能直接弹安装框时（iPhone、微信里、没触发安装事件的安卓），
// 按当前浏览器写几步手动操作；也把「添加之后能怎样、不能怎样」说清楚。
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { detectInstallEnv, type InstallEnv } from '@/platform/installEnv'
import { Button, Screen, Section } from '@/ui'
import { L } from '@/i18n'

const installSteps = (): Record<InstallEnv, { title: string; steps: string[]; copy?: boolean }> => ({
  'ios-safari': {
    title: L('iPhone / iPad 的 Safari', 'Safari on iPhone / iPad'),
    steps: [
      L(
        '点浏览器的「分享」按钮（iPhone 在屏幕底部，新版 iOS 收在右下角「⋯」里；iPad 在右上角）',
        'Tap the browser’s “Share” button (on iPhone it’s at the bottom of the screen — newer iOS tucks it into “⋯” at the bottom right; on iPad it’s at the top right)',
      ),
      L('往下翻，点「添加到主屏幕」', 'Scroll down and tap “Add to Home Screen”'),
      L('点右上角「添加」', 'Tap “Add” at the top right'),
    ],
  },
  'ios-other': {
    title: L('换 Safari 打开', 'Open in Safari'),
    steps: [
      L(
        '苹果设备上只有 Safari 能把网页添加到主屏幕，这个浏览器不行',
        'On Apple devices only Safari can add web pages to the Home Screen; this browser can’t',
      ),
      L('点下面的「复制网址」，在 Safari 里粘贴打开', 'Tap “Copy URL” below, then paste it into Safari'),
      L(
        '再点 Safari 的「分享」›「添加到主屏幕」›「添加」',
        'Then in Safari tap “Share” › “Add to Home Screen” › “Add”',
      ),
    ],
    copy: true,
  },
  wechat: {
    title: L('先用浏览器打开', 'Open in a browser first'),
    steps: [
      L(
        '微信 / QQ 里没有「添加到主屏幕」，先点右上角的「⋯」，选「在浏览器打开」（iPhone 选「在 Safari 中打开」）',
        'WeChat / QQ have no “Add to Home Screen”. Tap “⋯” at the top right and choose “Open in browser” (on iPhone, “Open in Safari”)',
      ),
      L(
        '在浏览器里再回到这一页，按那个浏览器的步骤添加：iPhone 点「分享」›「添加到主屏幕」，安卓点「⋮」›「添加到主屏幕」',
        'Come back to this page in the browser and follow its steps: on iPhone tap “Share” › “Add to Home Screen”; on Android tap “⋮” › “Add to Home Screen”',
      ),
    ],
    copy: true,
  },
  'android-chrome': {
    title: L('安卓的 Chrome', 'Chrome on Android'),
    steps: [
      L('点右上角的「⋮」', 'Tap “⋮” at the top right'),
      L('选「添加到主屏幕」或「安装应用」', 'Choose “Add to Home Screen” or “Install app”'),
      L('确认「安装」或「添加」', 'Confirm “Install” or “Add”'),
    ],
  },
  'android-other': {
    title: L('安卓的浏览器', 'Android browser'),
    steps: [
      L(
        '打开浏览器的菜单（通常是右上角或底部的「⋮」「≡」）',
        'Open the browser menu (usually “⋮” or “≡” at the top right or bottom)',
      ),
      L(
        '找「添加到主屏幕」或「安装应用」，点一下确认',
        'Find “Add to Home Screen” or “Install app” and tap to confirm',
      ),
      L('找不到的话，换 Chrome 打开这个网址再试', 'If you can’t find it, open this URL in Chrome and try again'),
    ],
    copy: true,
  },
  desktop: {
    title: L('电脑的浏览器', 'Computer browser'),
    steps: [
      L(
        'Chrome / Edge：点地址栏右边的「安装」图标，或菜单里的「安装像素星空」',
        'Chrome / Edge: click the “Install” icon on the right of the address bar, or “Install PixelSky” in the menu',
      ),
      L(
        'Mac 的 Safari：菜单栏「文件」›「添加到程序坞」',
        'Safari on Mac: in the menu bar choose “File” › “Add to Dock”',
      ),
    ],
  },
})

export function AddToHome({ onBack }: { onBack(): void }) {
  const env = detectInstallEnv(navigator.userAgent, navigator.maxTouchPoints)
  const { title, steps, copy } = installSteps()[env]
  const [copied, setCopied] = useState(false)
  const copyUrl = () =>
    // 不带 # 后面的内容（配对链接的数据在那里）
    navigator.clipboard
      ?.writeText(location.origin + location.pathname)
      .then(() => setCopied(true))
      .catch(() => undefined)

  return (
    <Screen title={L('添加到主屏幕', 'Add to Home Screen')} onBack={onBack}>
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
              <Copy size={18} /> {copied ? L('已复制', 'Copied') : L('复制网址', 'Copy URL')}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3 px-5 text-meta text-fg-muted">
          <p>
            {L(
              '添加后从桌面图标打开，像 App 一样全屏，没有地址栏',
              'Once added, open it from the Home Screen icon: full screen like an app, no address bar',
            )}
            {env.startsWith('ios') || env === 'wechat'
              ? L(
                  '；配对也不会因为久不打开被 Safari 清掉（Safari 连续 7 天没打开过网页，会清掉网页存的数据）。',
                  '. Pairing also won’t be cleared by Safari if you don’t open it for a while (Safari clears a site’s data after 7 days without a visit).',
                )
              : L('。', '.')}
          </p>
          <p className="text-fg-secondary">
            {L(
              '后台提醒仍然收不到：网页切到后台就会被浏览器暂停，连接断了。要提醒请用安卓 App，或者回到页面查看。',
              'You still won’t get alerts in the background: the browser pauses the page and the connection drops. For alerts, use the Android app, or come back to the page to check.',
            )}
          </p>
        </div>
      </div>
    </Screen>
  )
}
