// 右键菜单用的剪贴板：正常走主进程（不受页面焦点限制），演示模式用浏览器的（和编辑器右键菜单一样）
import { isDemo } from '@/data'

export const clipboardWrite = (text: string): Promise<unknown> =>
  isDemo || !window.pixelsky ? navigator.clipboard.writeText(text) : window.pixelsky.terminal.clipboardWrite(text)

export const clipboardRead = (): Promise<string> =>
  isDemo || !window.pixelsky ? navigator.clipboard.readText() : window.pixelsky.terminal.clipboardRead()
