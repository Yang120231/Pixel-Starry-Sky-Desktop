import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 多对话窗格区：顶部栏（跟随当前窗格）+ 按布局树绝对定位的窗格 + 分隔线。规格见 docs/ui/multi-pane.md
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import './panes.css'
import { SessionHeader } from '@/features/session/SessionHeader'
import { useHeaderActions } from '@/features/session/SessionView'
import { cn } from '@/ui'
import { isLive, setViewingSet, useEngineState, useSessionTitle } from '@/features/engine'
import {
  CLOSE_TAB,
  CYCLE_PANE,
  CYCLE_TAB,
  JUMP_PANE,
  SPLIT_DOWN,
  SPLIT_RIGHT,
  ZOOM_PANE,
} from '@/features/layout/shortcuts'
import { PaneView } from './PaneView'
import { MIN_PANE, paneActions, usePaneState } from './store'
import {
  computeRects,
  dragDivider,
  findSplit,
  focusedTab,
  isNewTab,
  isFileTab,
  parseFileTab,
  leaves,
  visibleTabs,
  type Divider,
  type Rect,
} from './tree'
import { useFiles } from '@/features/files/store'
import { useActiveWorkspace } from '@/features/editor/target'
import { DragPreview, PaneDragContext, usePaneDrag } from './drag'
import { useTheme } from '@/features/appearance/ThemeProvider'
import { getPage, usePage } from '@/features/layout/page'
import { selectedChannel, useChannels } from '@/features/channels/store'

export interface WorkspaceProps {
  sidebarOpen: boolean
  panelOpen: boolean
  onToggleSidebar: () => void
  onTogglePanel: () => void
  filesPanelOpen?: boolean
  onCloseFiles?: () => void
}

const pct = (v: number): string => `${v * 100}%`
const dividerKey = (d: Divider): string => `${d.splitId}-${d.index}`
/** 分隔线拖到头时的预览：盖在要放大的窗格上，四边各缩进 4px */
const snapStyle = (r: Rect) => ({
  left: `calc(${pct(r.x)} + 4px)`,
  top: `calc(${pct(r.y)} + 4px)`,
  width: `calc(${pct(r.w)} - 8px)`,
  height: `calc(${pct(r.h)} - 8px)`,
})

/** 全局顶栏跨过会话区与右侧面板，右侧工具位置不随面板开合移动。 */
export function WorkspaceHeader({ membersShown = false, ...props }: WorkspaceProps & { membersShown?: boolean }) {
  useI18n()
  const current = usePaneState(s => focusedTab(s.layout))
  const sessionId = current && !isNewTab(current) && !isFileTab(current) ? current : null
  const title = useSessionTitle(sessionId)
  const files = useFiles(),
    file = files.tabs.find(t => t.id === current),
    parsed = current ? parseFileTab(current) : null
  const showActions = useHeaderActions(sessionId)
  // 标签栏上已经有标题，顶栏改为显示所在的工作区（docs/ui/workbench-ux-3.md §2.1）
  const workspace = useActiveWorkspace()
  const page = usePage()
  const channel = useChannels(selectedChannel)
  // 协作频道页沿用同一个顶栏（换组件会丢焦点）：标题是频道名，面板开关控制成员面板（docs/ui/channels.md §2）
  // 任务看板（docs/ui/task-board.md §2）：顶栏标题是「任务看板」，没有右侧面板开关
  if (page === 'board')
    return (
      <SessionHeader
        {...props}
        title={tr('board.title')}
        showActions={false}
        panelOpen={false}
        filesPanelOpen={false}
        panelToggle={null}
      />
    )
  if (page === 'channels') {
    const toggle = channel
      ? {
          open: membersShown,
          label: tr(membersShown ? 'channels.members.hide' : 'channels.members.show'),
          onToggle: props.onTogglePanel,
        }
      : null
    return (
      <SessionHeader
        {...props}
        title={channel ? `# ${channel.name}` : tr('channels.title')}
        showActions={false}
        panelOpen={false}
        filesPanelOpen={false}
        panelToggle={toggle}
      />
    )
  }
  return (
    <SessionHeader
      title={file?.name ?? parsed?.path.split('/').pop() ?? title}
      workspace={workspace}
      showActions={showActions && !parsed}
      {...props}
    />
  )
}

export function Workspace(props: WorkspaceProps) {
  useI18n()
  const layout = usePaneState(s => s.layout)
  const closing = usePaneState(s => s.closing)
  const notice = usePaneState(s => s.notice)
  const areaRef = useRef<HTMLDivElement>(null)
  const drag = usePaneDrag(areaRef)
  /** 正在拖动的分隔线（key），拖动时窗格跟手不加过渡、这条线保持高亮 */
  const [resizing, setResizing] = useState<string | null>(null)
  /** 分隔线拖到头时，松手要放大的窗格（显示预览） */
  const [snapTarget, setSnapTarget] = useState<string | null>(null)

  const all = useMemo(() => leaves(layout.root), [layout.root])
  const { panes, dividers } = useMemo(() => computeRects(layout.root), [layout.root])
  const multi = all.length - Object.keys(closing).length > 1 || all.length > 1
  // 只比较几何 / 结构变化，标签文字、流式事件和选中标签都不重启焦点高亮。
  const focusGeometry = JSON.stringify([
    layout.maximized,
    Object.keys(closing),
    [...panes].map(([id, r]) => [id, r.x, r.y, r.w, r.h]),
  ])

  // 所有窗格里正在显示的会话都算「正在看」，回复完不标新回复
  const visibleKey = visibleTabs(layout)
    .filter(t => !isNewTab(t) && !isFileTab(t))
    .join('|')
  // 在协作频道页时没有会话算「正在看」，后台回复完照常标新回复（docs/ui/channels.md §2）
  const page = usePage()
  useEffect(() => setViewingSet(page === 'workbench' && visibleKey ? visibleKey.split('|') : []), [visibleKey, page])

  // 真实引擎读出会话列表后，去掉已经不存在的会话标签（只做一次）
  const ready = useEngineState(s => s.ready)
  const sessions = useEngineState(s => s.sessions)
  const pruned = useRef(false)
  useEffect(() => {
    if (!isLive || !ready || pruned.current) return
    pruned.current = true
    const ids = new Set(sessions.map(s => s.record.id))
    paneActions.prune(tab => isNewTab(tab) || ids.has(tab))
  }, [ready, sessions])

  const areaSize = useCallback(() => {
    const r = areaRef.current?.getBoundingClientRect()
    return { width: r?.width ?? window.innerWidth, height: r?.height ?? window.innerHeight }
  }, [])

  // 窗格快捷键（docs/ui/multi-pane.md §4）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        getPage() !== 'workbench' ||
        e.defaultPrevented ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-terminal-input]'))
        return
      let handled = true
      const jump = JUMP_PANE.index(e)
      const cyclePane = CYCLE_PANE.delta(e)
      const cycleTab = CYCLE_TAB.delta(e)
      if (SPLIT_RIGHT.match(e)) paneActions.split('row', areaSize())
      else if (SPLIT_DOWN.match(e)) paneActions.split('col', areaSize())
      else if (CLOSE_TAB.match(e)) paneActions.closeCurrent()
      else if (ZOOM_PANE.match(e)) paneActions.toggleMaximize()
      else if (jump >= 0) paneActions.focusIndex(jump)
      else if (cyclePane) paneActions.cycleFocus(cyclePane)
      else if (cycleTab) paneActions.cycleTab(cycleTab)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [areaSize])

  // 拖动分隔线：跟手改占比，相邻两块各自不小于最小尺寸；拖过最小尺寸到头时松手放大另一边（比例回到拖之前）
  const startDrag = (d: Divider, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const split = findSplit(layout.root, d.splitId)
    const area = areaRef.current?.getBoundingClientRect()
    if (!split || !area) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setResizing(dividerKey(d))
    const total = split.sizes.reduce((a, b) => a + b, 0)
    const span = d.dir === 'row' ? d.splitRect.w * area.width : d.splitRect.h * area.height
    const pxPerUnit = span / total
    const minPx = d.dir === 'row' ? MIN_PANE.width : MIN_PANE.height
    const pair = split.sizes[d.index] + split.sizes[d.index + 1]
    const minUnit = Math.min(minPx / pxPerUnit, pair / 2)
    const startA = split.sizes[d.index]
    const start = d.dir === 'row' ? e.clientX : e.clientY
    let snap: string | null = null
    const move = (ev: PointerEvent) => {
      const delta = ((d.dir === 'row' ? ev.clientX : ev.clientY) - start) / pxPerUnit
      const next = dragDivider(split, d.index, startA + delta, minUnit, pxPerUnit)
      paneActions.setSizes(split.id, next.sizes)
      if (next.maximize !== snap) setSnapTarget((snap = next.maximize))
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setResizing(null)
      setSnapTarget(null)
      if (snap && ev.type === 'pointerup') {
        paneActions.setSizes(split.id, split.sizes)
        paneActions.toggleMaximize(snap)
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const full: Rect = { x: 0, y: 0, w: 1, h: 1 }

  return (
    <PaneDragContext.Provider value={drag.begin}>
      <main className="flex min-h-0 min-w-[464px] flex-1 flex-col bg-app">
        <div
          ref={areaRef}
          className="pane-area relative min-h-0 flex-1 overflow-hidden"
          data-resizing={resizing !== null || undefined}
        >
          {all.map(leaf => {
            const maximized = layout.maximized === leaf.id
            const hidden = layout.maximized !== null && !maximized
            const r = maximized ? full : (panes.get(leaf.id) ?? full)
            return (
              <div
                key={leaf.id}
                className={cn(
                  'pane-box absolute overflow-hidden',
                  maximized && 'z-10',
                  hidden && 'pointer-events-none opacity-0',
                )}
                style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                inert={hidden || !!closing[leaf.id]}
              >
                <PaneView
                  leaf={leaf}
                  focused={leaf.id === layout.focused && multi}
                  showHead={multi}
                  maximized={maximized}
                  areaSize={areaSize}
                  sidebarOpen={props.sidebarOpen}
                  panelOpen={props.panelOpen}
                  onToggleSidebar={props.onToggleSidebar}
                  onTogglePanel={props.onTogglePanel}
                />
              </div>
            )
          })}

          {/* 分隔线：窗格之间不留缝，只画一条 1px 实线（样式在 panes.css）；悬停 / 拖动时加粗成强调色；双击均分 */}
          {dividers.map(d => {
            const row = d.dir === 'row'
            const key = dividerKey(d)
            const style = row
              ? { left: pct(d.at), top: pct(d.splitRect.y), height: pct(d.splitRect.h), width: 8, marginLeft: -4 }
              : { top: pct(d.at), left: pct(d.splitRect.x), width: pct(d.splitRect.w), height: 8, marginTop: -4 }
            return (
              <div
                key={key}
                role="separator"
                aria-orientation={row ? 'vertical' : 'horizontal'}
                aria-label={tr('panes.Workspace.dragToResizePanes')}
                title={tr('panes.Workspace.dragToResizePanes')}
                className={cn(
                  'pane-divider absolute z-20',
                  row ? 'cursor-col-resize' : 'cursor-row-resize',
                  layout.maximized && 'pointer-events-none opacity-0',
                )}
                data-active={resizing === key || undefined}
                style={style}
                onPointerDown={e => startDrag(d, e)}
                onDoubleClick={() => paneActions.equalize(d.splitId)}
              >
                <span className="pane-divider-line" />
              </div>
            )
          })}

          <FocusFrame
            rect={multi && !layout.maximized ? panes.get(layout.focused) : undefined}
            focusedId={layout.focused}
            geometry={focusGeometry}
            resizing={resizing !== null}
          />

          {snapTarget && panes.has(snapTarget) && (
            <div
              data-snap-preview
              className="pointer-events-none absolute z-30 flex items-center justify-center rounded-lg border-2 border-accent bg-accent-soft/60"
              style={snapStyle(panes.get(snapTarget)!)}
            >
              <span className="mx-4 rounded-md bg-popover px-3 py-2 text-center text-ui text-fg shadow-menu">
                {tr('panes.Workspace.releaseToMaximize')}
              </span>
            </div>
          )}
          <DragPreview visual={drag.visual} area={areaRef} />
          {notice && <Notice key={notice.id} text={notice.text} />}
        </div>
      </main>
    </PaneDragContext.Provider>
  )
}

/**
 * 当前窗格的强调色框（docs/ui/multi-pane.md §3）：画在窗格区这一层、压在分隔线上面，
 * 不在窗格边上就往右 / 往下多占 1px，盖住分隔线；焦点提示与布局伸缩分别处理。
 */
function FocusFrame({
  rect: r,
  focusedId,
  geometry,
  resizing,
}: {
  rect: Rect | undefined
  focusedId: string
  geometry: string
  resizing: boolean
}) {
  useI18n()
  const frame = useRef<HTMLDivElement>(null)
  const { paneFocusMotion, motion, systemReducedMotion } = useTheme()
  const enabled = motion === 'on' || (motion === 'system' && !systemReducedMotion)
  const visible = !!r
  const previous = useRef({ focusedId, geometry, visible })
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { focusedId, geometry, visible }
    const el = frame.current
    if (!el) return
    el.removeAttribute('data-flash')
    const switching =
      before.visible && visible && before.focusedId !== focusedId && before.geometry === geometry && !resizing
    if (!switching) return
    if (paneFocusMotion !== 'slide' || !enabled) {
      // 稳定复用同一个框保留结构动画；仅换焦点的这一帧取消位置过渡。
      el.setAttribute('data-focus-jump', '')
      void el.offsetWidth
      el.removeAttribute('data-focus-jump')
    }
    if (paneFocusMotion === 'flash' && enabled) {
      // 短时间连续切换也能重播，既有焦点再次点击不会触发。
      void el.offsetWidth
      el.setAttribute('data-flash', '')
    }
  }, [focusedId, geometry, visible, resizing, paneFocusMotion, enabled])
  if (!r) return null
  const edge = (end: number, v: number): string => (end < 1 - 1e-6 ? `calc(${pct(v)} + 1px)` : pct(v))
  return (
    <div
      aria-hidden
      ref={frame}
      data-focus-pane={focusedId}
      onAnimationEnd={e => {
        if (e.animationName === 'pane-focus-flash') e.currentTarget.removeAttribute('data-flash')
      }}
      className="pane-focus-frame pointer-events-none absolute z-20 border border-accent/70"
      style={{ left: pct(r.x), top: pct(r.y), width: edge(r.x + r.w, r.w), height: edge(r.y + r.h, r.h) }}
    />
  )
}

/** 底部浮出的一句提示，2.5 秒后消失 */
function Notice({ text }: { text: string }) {
  useI18n()
  const [show, setShow] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 2500)
    return () => window.clearTimeout(t)
  }, [])
  if (!show) return null
  return (
    <div
      role="status"
      className="pane-notice absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-2 text-ui text-fg shadow-popover"
    >
      {text}
    </div>
  )
}
