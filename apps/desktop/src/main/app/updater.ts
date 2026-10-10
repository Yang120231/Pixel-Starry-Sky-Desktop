// 自动更新（docs/release-update.md §7）：更新源是 GitHub Releases。
// 安装版：启动 10 秒后查一次、之后每 4 小时一次，有新版就后台下载，下好提示「重启以更新」，不点也在退出时装上。
// 便携版：只检查，有新版提示去下载页。开发模式不检查（PIXELSKY_UPDATE_FEED 指向本机静态服务器时除外，用来测完整流程）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../shared/types/update'
import * as ipc from '../ipc/guard'
import type { AppContext } from './context'
import { channel, REPO_URL } from './info'
import { isNoRelease, notesText, updateError } from './update-notes'

const FIRST_CHECK_DELAY = 10_000
const CHECK_EVERY = 4 * 60 * 60 * 1000
const [OWNER, REPO] = new URL(REPO_URL).pathname.slice(1).split('/')

/** 「接收测试版」开关存在 userData/update.json，默认开（现在只有测试版） */
const settingsFile = (): string => join(app.getPath('userData'), 'update.json')
function readBeta(): boolean {
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')) as { beta?: unknown }
    return typeof saved.beta === 'boolean' ? saved.beta : true
  } catch {
    return true
  }
}
function saveBeta(beta: boolean): void {
  writeFileSync(settingsFile(), JSON.stringify({ beta }, null, 2))
}

export function initUpdater(ctx: AppContext): void {
  const feed = process.env.PIXELSKY_UPDATE_FEED
  const supported = app.isPackaged || !!feed
  const runAs = channel()
  // 便携版没法替换自己：只检查，不下载
  const portable = runAs === 'portable'
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported', channel: runAs, beta: readBeta() }
  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch }
    ctx.events.broadcast('update:changed', state)
  }

  const check = (): void => {
    if (!supported || state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return
    set({ status: 'checking', error: undefined })
    // 失败会走 error 事件，这里只防止未处理的 Promise
    autoUpdater.checkForUpdates().catch(() => undefined)
  }

  if (supported) {
    autoUpdater.autoDownload = !portable
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = state.beta
    autoUpdater.logger = null
    if (feed) {
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    } else {
      // 直接指定源，不依赖安装包里的 app-update.yml（便携版没有这个文件）
      autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
    }

    const found = (info: UpdateInfo): Partial<UpdateState> => ({
      version: info.version,
      notes: notesText(info.releaseNotes),
    })
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      set({ ...found(info), status: portable ? 'available' : 'downloading', percent: 0, checkedAt: Date.now() }),
    )
    autoUpdater.on('update-not-available', () =>
      set({ status: 'latest', version: undefined, notes: undefined, checkedAt: Date.now() }),
    )
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      set({ status: 'downloading', percent: Math.floor(p.percent) }),
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => set({ ...found(info), status: 'ready', percent: 100 }))
    autoUpdater.on('error', (err: Error) => {
      const message = String(err?.message ?? err)
      // 下载中途失败：回到可以重新检查的状态
      if (isNoRelease(message)) set({ status: 'latest', version: undefined, notes: undefined, checkedAt: Date.now() })
      else set({ status: 'error', error: updateError(message), percent: undefined, checkedAt: Date.now() })
    })

    setTimeout(check, FIRST_CHECK_DELAY)
    setInterval(check, CHECK_EVERY)
  }

  const deny = { deny: '不允许的调用方' }
  ipc.handle('update:state', () => state, deny)
  ipc.handle(
    'update:check',
    () => {
      check()
      return state
    },
    deny,
  )
  ipc.handle(
    'update:install',
    () => {
      if (state.status !== 'ready') throw new Error('新版本还没有下载好')
      // 静默安装，装完自动重新打开
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
    },
    deny,
  )
  ipc.handle(
    'update:download',
    () => shell.openExternal(state.version ? `${REPO_URL}/releases/tag/v${state.version}` : `${REPO_URL}/releases`),
    deny,
  )
  ipc.handle(
    'update:setBeta',
    (_event, beta: unknown) => {
      if (typeof beta !== 'boolean') throw new Error('参数错误')
      saveBeta(beta)
      autoUpdater.allowPrerelease = beta
      set({ beta })
      // 换了渠道重新查一次（检查中 / 下载中 / 已下载时 check 自己会跳过）
      check()
      return state
    },
    deny,
  )
}
