// 右键菜单用的剪贴板：正常走主进程（不受页面焦点限制），演示模式用浏览器的（和编辑器右键菜单一样）
import { isDemo } from '@/data'

export const clipboardWrite = (text: string): Promise<unknown> =>
  isDemo || !window.pixelsky ? navigator.clipboard.writeText(text) : window.pixelsky.terminal.clipboardWrite(text)

export const clipboardRead = (): Promise<string> =>
  isDemo || !window.pixelsky ? navigator.clipboard.readText() : window.pixelsky.terminal.clipboardRead()

/** 系统粘贴：主进程对当前页面执行一次粘贴，焦点所在的输入框收到和 Ctrl+V 一样的 paste 事件（带图片、复制的文件）。
 *  演示模式没有主进程，返回 false，由调用方退回只读文字 */
export const systemPaste = (): Promise<boolean> =>
  isDemo || !window.pixelsky ? Promise.resolve(false) : window.pixelsky.terminal.paste().then(() => true)
