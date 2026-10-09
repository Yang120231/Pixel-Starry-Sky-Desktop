import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC_CONTRACT, type IpcChannelName, type IpcChannelSpec, type IpcTrust } from '@pixelsky/protocol'

/**
 * 主进程 IPC 注册的唯一入口：按契约（packages/protocol/src/ipc/contract.ts）里每个通道的 `trust` 档位校验调用方，
 * 再调用处理函数。主进程其他文件不再直接用 `ipcMain.handle / on`，也没有自己的来源校验。
 *
 * 档位（越往下越严，前一档的条件都要满足）：
 * - `none`：不校验。
 * - `sender`：来源页面是应用自己的页面（打包后的本地文件，或开发服务器的同源页面）。
 * - `frame`：再要求来自窗口的顶层主框架。
 * - `window`：再要求调用方所在的窗口存在，且（默认）该窗口的 webContents 就是调用方，内嵌网页视图不能冒充。
 *
 * 每个通道的拒绝方式不同（有的抛「不受信任的页面」，有的抛别的文案，有的软失败返回固定值），
 * 逐通道的行为表见 docs/restructure.md §8.3 P5；这里用 `GuardOptions` 逐个注册点保持原样。
 */
type Channel<K extends IpcChannelSpec['kind']> = {
  [C in IpcChannelName]: (typeof IPC_CONTRACT)[C]['kind'] extends K ? C : never
}[IpcChannelName]
/** 可以用 `handle` 注册的通道（`ipcRenderer.invoke`）。 */
export type InvokeChannel = Channel<'invoke'>
/** 可以用 `on` 注册的通道（`ipcRenderer.send` / `sendSync`）。 */
export type SendChannel = Channel<'send' | 'sendSync'>

export const DEFAULT_DENY = '不受信任的页面'

export interface OnOptions {
  /** window 档：不要求窗口的 webContents 就是调用方，只要求窗口存在（终端、窗口控制的现状）。 */
  looseOwner?: true
}
export interface HandleOptions extends OnOptions {
  /** 未受信时抛出的文案，默认「不受信任的页面」。 */
  deny?: string
  /** 软失败：未受信时不抛错，改为返回它的结果（`account:get` 返回未登录、`notify:supported` 返回 false 等）。 */
  onUntrusted?: () => unknown
  /** window 档：窗口不存在或已销毁时抛出的文案；不给则按未受信处理，只要求窗口存在。 */
  noWindow?: string
}

const registered = new Set<string>()
const contract: Readonly<Record<string, IpcChannelSpec>> = IPC_CONTRACT

function trustOf(channel: string, kinds: readonly IpcChannelSpec['kind'][]): IpcTrust {
  const spec = Object.hasOwn(contract, channel) ? contract[channel] : undefined
  if (!spec) throw new Error(`IPC 通道不在契约里：${channel}`)
  if (!kinds.includes(spec.kind)) throw new Error(`IPC 通道 ${channel} 的类型是 ${spec.kind}，不能这样注册`)
  if (registered.has(channel)) throw new Error(`IPC 通道重复注册：${channel}`)
  registered.add(channel)
  return spec.trust
}

/** 来源页面是应用自己的页面（打包后的本地文件，或开发服务器的同源页面）。 */
function trustedPage(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    const u = new URL(event.senderFrame?.url ?? '')
    if (u.protocol === 'file:') return true
    const dev = process.env.ELECTRON_RENDERER_URL
    return !!dev && !app.isPackaged && u.origin === new URL(dev).origin
  } catch {
    return false
  }
}

type Verdict = 'ok' | 'untrusted' | 'noWindow'

function check(event: IpcMainEvent | IpcMainInvokeEvent, trust: IpcTrust, opts: HandleOptions): Verdict {
  if (trust === 'none') return 'ok'
  if (!trustedPage(event)) return 'untrusted'
  if (trust === 'sender') return 'ok'
  if (event.senderFrame !== event.sender.mainFrame) return 'untrusted'
  if (trust === 'frame') return 'ok'
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || (opts.noWindow !== undefined && win.isDestroyed()))
    return opts.noWindow !== undefined ? 'noWindow' : 'untrusted'
  if (!opts.looseOwner && win.webContents !== event.sender) return 'untrusted'
  return 'ok'
}

/**
 * 注册 `ipcMain.handle` 通道：先按契约的信任档校验，通过后才调用 `fn`。
 * `fn` 的参数列表由各注册点自己声明（具体类型），这里用 `never[]` 接受任意参数列表；转发时的 IPC 参数不做类型保证。
 */
export function handle(
  channel: InvokeChannel,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  opts: HandleOptions = {},
): void {
  const trust = trustOf(channel, ['invoke'])
  ipcMain.handle(channel, (event, ...args) => {
    const verdict = check(event, trust, opts)
    if (verdict === 'noWindow') throw new Error(opts.noWindow)
    if (verdict === 'untrusted') {
      if (opts.onUntrusted) return opts.onUntrusted()
      throw new Error(opts.deny ?? DEFAULT_DENY)
    }
    return fn(event, ...(args as never[]))
  })
}

/** 注册 `ipcMain.on` 通道（`send` / `sendSync`）：未受信的调用静默忽略。 */
export function on(
  channel: SendChannel,
  fn: (event: IpcMainEvent, ...args: never[]) => void,
  opts: OnOptions = {},
): void {
  const trust = trustOf(channel, ['send', 'sendSync'])
  ipcMain.on(channel, (event, ...args) => {
    if (check(event, trust, opts) === 'ok') fn(event, ...(args as never[]))
  })
}
