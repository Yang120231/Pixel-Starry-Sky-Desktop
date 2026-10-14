// 双击图片放大查看（docs/ui/image-viewer.md）：盖住整个窗口的浮层，滚轮以鼠标为中心缩放、拖动平移、
// 双击在「适应窗口」和「原始大小」之间切换；+ / - / 0 / 1 键，Esc 或点空白处关闭，焦点还给打开前的元素
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Minus, Plus, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from './cn'
import { useToast } from './ComingSoon'
import { clampPan, fitScale, fitView, STEP, wheelFactor, zoomAt, type Size, type View } from './imageZoom'

/** 适应窗口时四周留的边（看得出哪里是空白，点空白处能关） */
const MARGIN = 24
const room = (viewport: Size): Size => ({
  width: Math.max(1, viewport.width - MARGIN * 2),
  height: Math.max(1, viewport.height - MARGIN * 2),
})

const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`

/** 把图片转成 PNG 放进剪贴板（剪贴板只认 PNG） */
async function copyImage(img: HTMLImageElement): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('canvas')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export function ImageViewer({
  src,
  name,
  bytes,
  actions,
  onClose,
}: {
  src: string
  name: string
  /** 文件大小；不知道时不写 */
  bytes?: number
  /** 工具栏里额外的按钮（附件的「标注」） */
  actions?: ReactNode
  onClose: () => void
}) {
  useI18n()
  const toast = useToast()
  const dialog = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    img = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  /** 刚拖动过：松开时的 click 不算点空白处 */
  const moved = useRef(false)
  const latest = useRef({ view, natural, viewport })
  latest.current = { view, natural, viewport }
  const close = useRef(onClose)
  close.current = onClose

  // 焦点进浮层，关掉时还回去；Esc 抢在别的快捷键（窗格、输入框）前面
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  // 视口大小
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 图读进来、窗口变了：还没动过就一直适应窗口
  const touched = useRef(false)
  useLayoutEffect(() => {
    if (natural && viewport.width && !touched.current) setView(fitView(natural, room(viewport)))
    else if (natural && viewport.width) setView(v => clampPan(v, natural, viewport))
  }, [natural, viewport.width, viewport.height])

  /** 相对视口中心的坐标 */
  const pointOf = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = stage.current!.getBoundingClientRect()
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }
  /** scale 是新的倍数，或者按当前倍数算新倍数（连着滚几格时每格都在上一格的结果上算） */
  const zoomTo = (scale: number | ((current: number) => number), point = { x: 0, y: 0 }): void => {
    const { natural: n, viewport: vp } = latest.current
    if (!n) return
    touched.current = true
    setView(v => zoomAt(v, typeof scale === 'function' ? scale(v.scale) : scale, point, n, vp))
  }
  const fit = (): void => {
    const { natural: n, viewport: vp } = latest.current
    if (!n) return
    touched.current = false
    setView(fitView(n, room(vp)))
  }

  // 滚轮要 preventDefault，React 的 onWheel 是 passive 的
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomTo(current => current * wheelFactor(e.deltaY), pointOf(e.clientX, e.clientY))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === '+' || e.key === '=') zoomTo(current => current * STEP)
    else if (e.key === '-' || e.key === '_') zoomTo(current => current / STEP)
    else if (e.key === '0') fit()
    else if (e.key === '1') zoomTo(1)
    else if (e.key === 'Tab') {
      // 焦点留在浮层里
      const items = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      items[(i + (e.shiftKey ? -1 : 1) + items.length + (i < 0 && e.shiftKey ? 1 : 0)) % items.length].focus()
    } else return
    e.stopPropagation()
  }

  const drag = useRef<{ id: number; x: number; y: number; start: View } | null>(null)
  const percent = Math.round(view.scale * 100)
  const tool =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-40'

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${tr('imageViewer.label')} ${name}`}
      tabIndex={-1}
      data-image-viewer=""
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[110] flex flex-col bg-scrim outline-none"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line-card bg-popover px-3 py-1.5 shadow-sm">
        <span className="min-w-0 flex-1 truncate px-1 text-meta text-fg-secondary" title={name}>
          <span className="font-medium text-fg">{name}</span>
          {natural && ` · ${natural.width}×${natural.height}`}
          {bytes !== undefined && ` · ${sizeText(bytes)}`}
        </span>
        <button
          type="button"
          className={tool}
          title={tr('imageViewer.zoomOut')}
          aria-label={tr('imageViewer.zoomOut')}
          onClick={() => zoomTo(current => current / STEP)}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          data-image-viewer-zoom=""
          className={cn(tool, 'w-14 tabular-nums')}
          title={tr('imageViewer.zoomLevel')}
          onClick={fit}
        >
          {percent}%
        </button>
        <button
          type="button"
          className={tool}
          title={tr('imageViewer.zoomIn')}
          aria-label={tr('imageViewer.zoomIn')}
          onClick={() => zoomTo(current => current * STEP)}
        >
          <Plus size={15} />
        </button>
        <span className="mx-1 h-4 border-l border-line" />
        <button type="button" className={tool} title={tr('imageViewer.fitTitle')} onClick={fit}>
          {tr('imageViewer.fit')}
        </button>
        <button type="button" className={tool} title={tr('imageViewer.actualTitle')} onClick={() => zoomTo(1)}>
          {tr('imageViewer.actual')}
        </button>
        <button
          type="button"
          className={tool}
          disabled={!natural}
          onClick={() =>
            void copyImage(img.current!)
              .then(() => toast(tr('imageViewer.copied')))
              .catch((e: Error) => toast(tr('imageViewer.copyFailed', { error: e.message })))
          }
        >
          <Copy size={14} />
          {tr('imageViewer.copy')}
        </button>
        {actions}
        <span className="mx-1 h-4 border-l border-line" />
        <button
          type="button"
          className={cn(tool, 'w-8 px-0')}
          title={tr('imageViewer.close')}
          aria-label={tr('imageViewer.close')}
          onClick={() => close.current()}
        >
          <X size={16} />
        </button>
      </div>
      <div
        ref={stage}
        className={cn('relative min-h-0 flex-1 overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={e => {
          if (e.button !== 0) return
          moved.current = false
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: view }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={e => {
          const d = drag.current
          if (!d || d.id !== e.pointerId || !natural) return
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y
          if (!moved.current && Math.hypot(dx, dy) < 3) return
          moved.current = true
          setDragging(true)
          touched.current = true
          setView(clampPan({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, natural, viewport))
        }}
        onPointerUp={e => {
          if (drag.current?.id === e.pointerId) drag.current = null
          setDragging(false)
        }}
        onClick={e => {
          // 点在图片外面的空白处才关；拖完松手不算
          if (moved.current || e.target !== e.currentTarget) return
          close.current()
        }}
      >
        <img
          ref={img}
          src={src}
          alt={name}
          draggable={false}
          onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          onDoubleClick={e => {
            const point = pointOf(e.clientX, e.clientY)
            const atActual = Math.abs(view.scale - 1) < 0.01
            // 小图「适应窗口」就是原始大小：双击放到 2 倍
            if (atActual && natural && fitScale(natural, room(viewport)) < 0.99) fit()
            else zoomTo(atActual ? 2 : 1, point)
          }}
          className={cn('absolute top-1/2 left-1/2 max-w-none select-none', !natural && 'invisible')}
          style={
            natural
              ? {
                  width: natural.width,
                  height: natural.height,
                  transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  imageRendering: view.scale >= 2 ? 'pixelated' : undefined,
                }
              : undefined
          }
        />
      </div>
    </div>,
    document.body,
  )
}

/** 能双击放大的图片：用法和 <img> 一样，多一个 bytes（显示在查看器的标题里） */
export function ZoomableImage({
  src,
  alt,
  bytes,
  className,
}: {
  src: string
  alt: string
  bytes?: number
  className?: string
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <img
        src={src}
        alt={alt}
        title={tr('imageViewer.hint')}
        data-zoomable-image=""
        onDoubleClick={() => setOpen(true)}
        className={cn('cursor-zoom-in', className)}
      />
      {open && <ImageViewer src={src} name={alt} bytes={bytes} onClose={() => setOpen(false)} />}
    </>
  )
}
