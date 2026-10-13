// 本机项目里的 HTML 在右侧浏览器里直接看效果（对话里点路径、编辑器头部的按钮）：拼成 file:// 地址交给内置浏览器，
// 主进程只放行项目目录里面的文件（main/workspace/browser.ts 的 pageUrl）。远程机器、演示模式不支持，调用方照旧打开源码
import { isDemo } from '@/data'
import { getActiveWorkspace } from '@/features/editor/target'
import { machineOf } from '@/features/machines/store'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { workspaceRoot } from './pathLinks'
import { fileUrl, isHtmlPath } from './fileUrl'

export { isHtmlPath }

/** 能预览就在浏览器里打开并返回 true；远程机器、演示模式、找不到根目录时返回 false */
export async function previewHtml(ref: WorkspaceRef, path: string): Promise<boolean> {
  if (isDemo || !window.pixelsky || !isHtmlPath(path) || machineOf(ref.projectId ?? ref.sessionId) !== 'local')
    return false
  const root = await workspaceRoot(ref)
  if (!root) return false
  // 浏览器标签跟着右侧面板当前的工作区走，请求要用同一个 ref 才会被接住（panel/BrowserTab.tsx）
  const target = getActiveWorkspace().ref ?? ref
  // 'pixelsky:open-browser' 即 panel/EnvironmentPanel.tsx 的 OPEN_BROWSER（不引那个大组件文件）
  window.dispatchEvent(new CustomEvent('pixelsky:open-browser', { detail: { ref: target, url: fileUrl(root, path) } }))
  return true
}
