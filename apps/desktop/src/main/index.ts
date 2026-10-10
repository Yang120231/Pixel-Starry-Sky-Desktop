import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { initAccount } from './account/account'
import * as ipc from './ipc/guard'
import { initAppInfo } from './app/info'
import { initUpdater } from './app/updater'
import { initEngine } from './engine/ipc'
import { initWorkspace } from './workspace/files-ipc'
import { initWindowControls, observeWindowControls } from './app/window-controls'
import { initUiLanguage, nativeText } from './app/ui-language'
import { initProjectTools } from './workspace/project-tools-ipc'
import { initNotifications } from './notifications/notifications'
import { confirmTerminalClose, closeWindowTerminals } from './terminal/ipc'
import { createAppContext } from './app/context'
import type { Locale } from '../shared/i18n/messages'

type ResolvedTheme = 'light' | 'dark'

// 与 docs/ui/design-tokens.md §1.6 保持一致
const TITLE_BAR: Record<ResolvedTheme, { color: string; symbolColor: string }> = {
  light: { color: '#F8F8F6', symbolColor: '#20211F' },
  dark: { color: '#1F1F1E', symbolColor: '#ECEBE7' },
}
const TITLE_BAR_HEIGHT = 48

// 截图模式：PIXELSKY_CAPTURE=<目录> 时按参考图尺寸截浅色/深色两张图后退出（见 scripts/capture.mjs）
const captureDir = process.env.PIXELSKY_CAPTURE
// 调试端口会向本机所有进程开放整个页面，只在开发环境（未打包）允许打开
const debugPort = app.isPackaged ? undefined : process.env.PIXELSKY_DEBUG_PORT
/** 主进程共用的状态：事件、退出任务、引擎 / SSH 机器 / 项目工具（app/context.ts） */
const ctx = createAppContext()
const closingAllowed = new WeakSet<BrowserWindow>()
const finishing = new WeakSet<BrowserWindow>()
let quitRequested = false
let quitReady = false
async function finishWindowClose(win: BrowserWindow): Promise<void> {
  if (finishing.has(win) || win.isDestroyed()) return
  finishing.add(win)
  try {
    if (!(await confirmTerminalClose(win))) {
      quitRequested = false
      return
    }
    await closeWindowTerminals(win)
    if (!win.isDestroyed()) {
      closingAllowed.add(win)
      win.close()
    }
  } finally {
    finishing.delete(win)
  }
}
ipc.handle(
  'files:finishClose',
  async event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) await finishWindowClose(win)
  },
  { deny: '不允许的调用方' },
)
app.on('before-quit', event => {
  if (quitReady) return
  event.preventDefault()
  if (quitRequested) return
  const windows = BrowserWindow.getAllWindows()
  if (windows.length && !captureDir) {
    quitRequested = true
    for (const win of windows) win.close()
    quitRequested = false
    return
  }
  quitRequested = true
  void ctx.lifecycle.shutdown().finally(() => {
    quitReady = true
    app.quit()
  })
})
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort)

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** 应用自己的页面：开发服务器的同源地址，或打包后的本地文件 */
function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && !app.isPackaged) return u.origin === new URL(dev).origin
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const initial: ResolvedTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const win = new BrowserWindow({
    // 截图模式使用参考图尺寸（docs/reference/workbench-session.jpg）
    width: 1568,
    height: captureDir ? 765 : 900,
    useContentSize: true,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: '像素星空',
    // 打包后 Windows 用 exe 自带的图标；开发模式用 build/icon.png
    ...(!app.isPackaged && { icon: join(__dirname, '../../build/icon.png') }),
    backgroundColor: TITLE_BAR[initial].color,
    ...(process.platform === 'win32'
      ? { frame: false }
      : process.platform === 'darwin'
        ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 18 } }
        : { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...TITLE_BAR[initial], height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // 截图模式窗口停在屏幕外，不能让它被当成后台窗口而暂停渲染
      backgroundThrottling: !captureDir,
    },
  })

  observeWindowControls(win)
  win.once('ready-to-show', () => {
    if (!captureDir) win.show()
  })
  win.on('close', event => {
    if (captureDir || closingAllowed.has(win) || win.webContents.isDestroyed()) return
    event.preventDefault()
    if (win.webContents.isCrashed()) {
      void finishWindowClose(win)
      return
    }
    win.webContents.send('files:beforeClose')
  })
  win.webContents.on('will-prevent-unload', event => {
    if (closingAllowed.has(win)) {
      event.preventDefault()
      return
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: nativeText(win, '文件尚未保存'),
      message: nativeText(win, '有文件包含未保存的修改，仍然退出吗？'),
      buttons: [nativeText(win, '返回保存'), nativeText(win, '放弃修改并退出')],
      defaultId: 0,
      cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
  })

  // 外部链接用系统浏览器打开
  // 只放行 http(s)，不把 file:、自定义协议等交给系统去处理
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 窗口不能被导航到应用以外的页面（否则那个页面也能用上预加载暴露的接口）
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (isWebUrl(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (captureDir) void capture(win, captureDir)
  return win
}

// 演示模式：PIXELSKY_DEMO=1 或启动参数带 --demo 时界面显示演示数据（pnpm dev:demo / 打包版 exe --demo），否则是空界面
ipc.on('app:config', event => {
  event.returnValue = { demo: process.env.PIXELSKY_DEMO === '1' || process.argv.includes('--demo') }
})

ipc.on('theme:set', (event, theme: ResolvedTheme, transparent?: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || (theme !== 'light' && theme !== 'dark')) return
  win.setBackgroundColor(TITLE_BAR[theme].color)
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    // 有壁纸时按钮区透明，按钮直接画在壁纸上（docs/ui/settings.md §6）
    const color = transparent === true ? '#00000000' : TITLE_BAR[theme].color
    win.setTitleBarOverlay({ ...TITLE_BAR[theme], color, height: TITLE_BAR_HEIGHT })
  }
})

async function capture(win: BrowserWindow, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await new Promise<void>(resolve => win.webContents.once('did-finish-load', () => resolve()))
  // 截图需要窗口在屏幕外可见才能拿到真实渲染结果
  win.setPosition(-4000, -4000)
  win.showInactive()
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const shots: Partial<Record<ResolvedTheme, Buffer>> = {}
  for (const theme of ['light', 'dark'] as const) {
    // 等 React 挂载出主题钩子，切换后确认 <html data-theme> 真的变了，否则报错退出
    let applied = ''
    for (let i = 0; i < 50 && applied !== theme; i++) {
      applied = await win.webContents.executeJavaScript(
        `(window.__pixelskySetTheme && window.__pixelskySetTheme(${JSON.stringify(theme)}), document.documentElement.dataset.theme || '')`,
      )
      if (applied !== theme) await sleep(100)
    }
    if (applied !== theme) {
      console.error(`[capture] 切换到 ${theme} 主题失败（当前 ${applied || '无'}）`)
      app.exit(1)
      return
    }
    // 空界面没有动画，合成器可能不出新帧，capturePage 会拿到上一主题的旧帧：
    // 强制重绘并等两次 requestAnimationFrame，确认新主题这一帧已经提交（最多等 2 秒，避免窗口不出帧时卡死）
    await sleep(300)
    win.webContents.invalidate()
    await win.webContents.executeJavaScript(
      'new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r(true))); setTimeout(() => r(false), 2000) })',
    )
    await sleep(300)
    const png = (await win.webContents.capturePage()).toPNG()
    shots[theme] = png
    await writeFile(join(dir, `${theme}.png`), png)
  }
  if (shots.light && shots.dark && shots.light.equals(shots.dark)) {
    console.error('[capture] 浅色和深色截图完全相同，深色主题没有渲染出来')
    app.exit(1)
    return
  }
  app.quit()
}

/**
 * 应用菜单：和 Electron 默认菜单一样（标题栏隐藏了，菜单不显示，但快捷键仍然有效），
 * 只是「窗口」菜单里去掉「关闭」—— 默认的 Ctrl+W 会直接关掉整个窗口，
 * 现在 Ctrl+W 交给界面关闭当前标签 / 窗格（docs/ui/multi-pane.md §4）。
 */
function setAppMenu(locale: Locale = 'zh-CN'): void {
  const template: MenuItemConstructorOptions[] = [
    // macOS 的应用菜单里已经有「退出」；其他平台放在「文件」菜单里。都不放「关闭窗口」
    process.platform === 'darwin'
      ? { role: 'appMenu' }
      : { label: locale === 'en-US' ? 'File' : '文件', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: locale === 'en-US' ? 'Window' : '窗口',
      submenu: [
        { role: 'minimize' },
        ...(process.platform === 'darwin' ? [{ role: 'zoom' } as MenuItemConstructorOptions] : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Windows 系统通知需要 AppUserModelID；开发版没有安装记录，用 Electron 本身的路径（docs/ui/notifications.md §4）
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.pixelsky.desktop' : process.execPath)

app.whenReady().then(async () => {
  setAppMenu()
  initUiLanguage(setAppMenu)
  initWindowControls()
  initNotifications() // 系统通知，见 notifications/notifications.ts
  initAccount() // 账号登录与额度，见 account/account.ts
  initAppInfo() // 「关于」页的版本与运行环境，见 app/info.ts
  initUpdater(ctx) // 自动更新（GitHub Releases），见 app/updater.ts
  await initEngine(ctx) // 引擎系统（Claude Code 等），见 engine/ipc.ts
  await initWorkspace(ctx)
  await initProjectTools(ctx)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
