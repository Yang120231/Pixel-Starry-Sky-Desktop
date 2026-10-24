// 图片（docs/mobile-remote.md §17 第 1 项）：加图片按钮（拍照 / 相册）、待发图片的缩略图、消息里的图片格子、全屏看图。
// 只管显示；压缩、取图、缓存在 data/images.ts。
import { useRef, useState } from 'react'
import { ImageIcon, ImagePlus, X } from 'lucide-react'
import { ActionSheet } from './sheet'
import { Spinner, cn } from './index'
import { L } from '@/i18n'

/** 加图片：点了选「拍照」或「从相册选」（App 里只有带 capture 的输入框才直接开相机） */
export function AttachButton({ onFiles, disabled }: { onFiles(files: File[]): void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const album = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState(false)
  const picked = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])]
    input.value = ''
    if (files.length) onFiles(files)
  }
  return (
    <>
      <button
        type="button"
        aria-label={L('添加图片', 'Add image')}
        disabled={disabled}
        onClick={() => setMenu(true)}
        className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
      >
        <ImagePlus size={20} strokeWidth={1.75} />
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => picked(e.target)} />
      <input ref={album} type="file" accept="image/*" multiple hidden onChange={e => picked(e.target)} />
      {menu && (
        <ActionSheet
          title={L('添加图片（最多 5 张，会压缩后发送）', 'Add images (up to 5, compressed before sending)')}
          onClose={() => setMenu(false)}
          actions={[
            { label: L('拍照', 'Take photo'), onSelect: () => camera.current?.click() },
            { label: L('从相册选', 'Choose from library'), onSelect: () => album.current?.click() },
          ]}
        />
      )}
    </>
  )
}

/** 待发的图片：一排缩略图，每张右上角可以删；正在压缩时最后一格转圈 */
export function AttachmentStrip({
  images,
  busy,
  onRemove,
}: {
  images: { id: string; src: string }[]
  busy: boolean
  onRemove(id: string): void
}) {
  if (!images.length && !busy) return null
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
      {images.map(i => (
        <div key={i.id} className="relative size-16 shrink-0">
          <img src={i.src} alt="" className="size-16 rounded-xl border border-line-subtle object-cover" />
          <button
            type="button"
            aria-label={L('删掉这张图片', 'Remove this image')}
            onClick={() => onRemove(i.id)}
            className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-fg text-app shadow"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      ))}
      {busy && (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-fg-faint">
          <Spinner size={16} />
        </div>
      )}
    </div>
  )
}

export interface ImageTile {
  key: string
  /** 已经有的图；没有时显示占位，点了再取 */
  src: string | null
  /** 占位上的说明，例如「1920×1080」 */
  label: string
  loading?: boolean
}

/** 消息里的图片格子 */
export function ImageTiles({
  tiles,
  onOpen,
  align = 'start',
}: {
  tiles: ImageTile[]
  onOpen(index: number): void
  align?: 'start' | 'end'
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', align === 'end' && 'justify-end')}>
      {tiles.map((t, i) => (
        <button
          key={t.key}
          type="button"
          aria-label={L('查看图片', 'View image')}
          onClick={() => onOpen(i)}
          className="relative flex size-20 items-center justify-center overflow-hidden rounded-xl border border-line-subtle bg-subtle text-fg-faint active:opacity-80"
        >
          {t.src ? (
            <img src={t.src} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 px-1 text-center">
              {t.loading ? <Spinner size={16} /> : <ImageIcon size={20} strokeWidth={1.5} />}
              <span className="font-mono text-label leading-tight">{t.label}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** 全屏看图：点任意处关闭；可以用系统的双指缩放 */
export function ImageViewer({ src, onClose }: { src: string; onClose(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={onClose}>
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      <button
        type="button"
        aria-label={L('关闭', 'Close')}
        onClick={onClose}
        className="absolute top-[max(env(safe-area-inset-top),12px)] right-3 flex size-10 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <X size={22} />
      </button>
    </div>
  )
}
