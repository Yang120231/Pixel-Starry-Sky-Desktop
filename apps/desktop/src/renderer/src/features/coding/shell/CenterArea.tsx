import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { CollapsibleSlot, ResizeHandle, cn } from '@/ui'
import { EditorArea } from '../editor'
import { BottomPanel } from '../bottom'
import { EDITOR_MIN_HEIGHT, PANEL_LIMITS, STATUSBAR_HEIGHT, TOPBAR_HEIGHT, type CodingFit } from '../layoutModel'
import { codingLayout, useCodingLayout } from '../layoutStore'
import { NarrowNotice } from './NarrowNotice'

/** 中栏：上半编辑器，下半可拖高、可最大化的底部面板 */
export function CenterArea({ fit, viewportHeight }: { fit: CodingFit; viewportHeight: number }) {
  useI18n()
  const { bottom } = useCodingLayout()
  const maxHeight = Math.max(
    PANEL_LIMITS.bottom.min,
    Math.min(PANEL_LIMITS.bottom.max, viewportHeight - TOPBAR_HEIGHT - STATUSBAR_HEIGHT - EDITOR_MIN_HEIGHT),
  )
  return (
    <div data-coding-center className="flex min-h-0 min-w-0 flex-1 flex-col bg-app">
      {fit.tooNarrow && <NarrowNotice />}
      <div
        data-vt-code-editor
        className={cn('min-h-0 min-w-0 flex-1 flex-col', fit.editorHidden ? 'hidden' : 'flex')}
        inert={fit.editorHidden}
      >
        <EditorArea visible={!fit.editorHidden} width={fit.centerWidth} />
      </div>
      <div className="relative flex w-full shrink-0 flex-col">
        {fit.bottom.shown && !bottom.maximized && (
          <ResizeHandle
            label={tr('coding.shell.resizeBottom')}
            axis="y"
            scale={-1}
            className="-top-1 right-0 left-0"
            value={fit.bottom.size}
            min={PANEL_LIMITS.bottom.min}
            max={maxHeight}
            onChange={v => codingLayout.setSize('bottom', v)}
            onCommit={v => codingLayout.setSize('bottom', v, true)}
            onReset={() => codingLayout.resetSize('bottom')}
          />
        )}
        <CollapsibleSlot open={fit.bottom.shown} size={fit.bottom.size} side="bottom">
          <div data-coding-bottom className="flex h-full min-w-0 flex-1 flex-col border-t border-line-layout bg-panel">
            <BottomPanel
              visible={fit.bottom.shown}
              tab={bottom.tab}
              maximized={bottom.maximized}
              listCollapsed={fit.terminalListCollapsed}
            />
          </div>
        </CollapsibleSlot>
      </div>
    </div>
  )
}
