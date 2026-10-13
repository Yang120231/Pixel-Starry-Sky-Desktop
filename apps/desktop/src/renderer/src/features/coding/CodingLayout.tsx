import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { CollapsibleSlot, ResizeHandle } from '@/ui'
import { MachineStatus } from '@/features/machines/MachineStatus'
import { usePage } from '@/features/layout/page'
import { useEnterCodingMode } from './enter'
import { useCodingRouting } from './routing'
import { PANEL_LIMITS, fitCoding } from './layoutModel'
import { codingLayout, useCodingLayout } from './layoutStore'
import { CodingTopBar } from './shell/CodingTopBar'
import { ToolStripe } from './shell/ToolStripe'
import { LeftArea } from './shell/LeftArea'
import { CenterArea } from './shell/CenterArea'
import { PageOverlay } from './shell/PageOverlay'
import { StatusBar } from './shell/StatusBar'
import { RightArea } from './right'

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = (): void => {
      setSize(prev =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** 代码模式的整窗布局：顶栏 / 两条工具条夹着三栏 / 状态栏（docs/ui/coding-mode-impl.md §5 W1-A） */
export function CodingLayout() {
  useI18n()
  useEnterCodingMode()
  useCodingRouting()
  const prefs = useCodingLayout()
  const viewport = useViewport()
  const onWorkbench = usePage() === 'workbench'
  const fit = fitCoding(prefs, viewport)
  return (
    <div data-coding-layout className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-app text-fg">
      <CodingTopBar />
      <MachineStatus />
      <div className="relative flex min-h-0 flex-1">
        <ToolStripe side="left" />
        {/* 看板 / 频道盖住时三栏保持挂载，只加 inert（D14） */}
        <div className="flex min-h-0 min-w-0 flex-1" inert={!onWorkbench}>
          <div data-vt-code-left className="relative flex min-h-0 shrink-0">
            <CollapsibleSlot open={fit.left.shown} width={fit.left.size} side="left">
              <div className="flex h-full min-w-0 flex-1 border-r border-line-layout">
                <LeftArea view={prefs.left.view} visible={fit.left.shown} />
              </div>
            </CollapsibleSlot>
            {fit.left.shown && (
              <ResizeHandle
                label={tr('coding.shell.resizeLeft')}
                axis="x"
                className="top-0 bottom-0 -right-1"
                value={fit.left.size}
                min={PANEL_LIMITS.left.min}
                max={PANEL_LIMITS.left.max}
                onChange={v => codingLayout.setSize('left', v)}
                onCommit={v => codingLayout.setSize('left', v, true)}
                onReset={() => codingLayout.resetSize('left')}
              />
            )}
          </div>
          <CenterArea fit={fit} viewportHeight={viewport.height} />
          <div className="relative flex min-h-0 shrink-0">
            {fit.right.shown && (
              <ResizeHandle
                label={tr('coding.shell.resizeRight')}
                axis="x"
                scale={-1}
                className="top-0 bottom-0 -left-1"
                value={fit.right.size}
                min={PANEL_LIMITS.right.min}
                max={PANEL_LIMITS.right.max}
                onChange={v => codingLayout.setSize('right', v)}
                onCommit={v => codingLayout.setSize('right', v, true)}
                onReset={() => codingLayout.resetSize('right')}
              />
            )}
            <CollapsibleSlot open={fit.right.shown} width={fit.right.size} side="right">
              <div data-coding-right className="flex h-full min-w-0 flex-1 border-l border-line-layout bg-sidebar">
                <RightArea visible={fit.right.shown} view={prefs.right.view} />
              </div>
            </CollapsibleSlot>
          </div>
        </div>
        <ToolStripe side="right" />
        <PageOverlay />
      </div>
      <StatusBar />
    </div>
  )
}
