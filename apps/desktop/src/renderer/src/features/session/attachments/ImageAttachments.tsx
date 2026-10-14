import { useEffect, useRef, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { ImageAnnotator } from './ImageAnnotator'
import type { ImageAttachment } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { imageBlob, imageSize } from './images'
import { cn } from '@/ui'
import { ImageViewer } from '@/ui/ImageViewer'

function ImageTile({
  image,
  onRemove,
  onReplace,
  compact = false,
}: {
  image: ImageAttachment
  /** 小缩略图、不显示文件名（消息队列里用；文件名在悬停提示里） */
  compact?: boolean
  onRemove?: (id: string) => void
  /** 标注后替换这张图（docs/ui/rewind-fork-sidechat.md §6） */
  onReplace?: (id: string, next: ImageAttachment) => void
}) {
  useI18n()
  const [url, setUrl] = useState(''),
    [open, setOpen] = useState(false),
    [annotating, setAnnotating] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(imageBlob(image))
    setUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image.id, image.dataBase64, image.mediaType])
  const description = `${image.name} · ${image.width}×${image.height} · ${imageSize(image.bytes)}`
  return (
    <>
      <div
        data-image-attachment={image.id}
        className={cn(
          'group relative overflow-hidden border border-line-card bg-subtle',
          compact ? 'size-10 rounded-md' : 'h-24 w-24 rounded-lg',
        )}
      >
        <button
          ref={trigger}
          type="button"
          className="block size-full"
          aria-label={`${tr('composer.attachment.preview')} ${image.name}`}
          title={description}
          onClick={() => setOpen(true)}
        >
          {url && <img src={url} alt={image.name} className="size-full object-cover" />}
        </button>
        {onReplace && (
          <button
            type="button"
            aria-label={`${tr('annotate.open')} ${image.name}`}
            title={tr('annotate.open')}
            onClick={() => setAnnotating(true)}
            className="absolute top-1 left-1 inline-flex size-5 items-center justify-center rounded-full border border-line-card bg-popover text-fg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover"
          >
            <Pencil size={11} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label={`${tr('composer.attachment.remove')} ${image.name}`}
            title={tr('composer.attachment.remove')}
            onClick={() => onRemove(image.id)}
            className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full border border-line-card bg-popover text-fg hover:bg-hover"
          >
            <X size={12} />
          </button>
        )}
        {!compact && (
          <span className="pointer-events-none absolute right-0 bottom-0 left-0 truncate border-t border-line-card bg-popover px-1 py-0.5 text-label text-fg-secondary">
            {image.name}
          </span>
        )}
      </div>
      {open && url && (
        <ImageViewer
          src={url}
          name={image.name}
          bytes={image.bytes}
          onClose={() => setOpen(false)}
          actions={
            onReplace && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setAnnotating(true)
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
              >
                <Pencil size={13} />
                {tr('annotate.open')}
              </button>
            )
          }
        />
      )}
      {annotating && onReplace && (
        <ImageAnnotator
          image={image}
          onClose={() => setAnnotating(false)}
          onDone={next => {
            setAnnotating(false)
            onReplace(image.id, next)
          }}
        />
      )}
    </>
  )
}
export function ImageAttachments({
  images,
  onRemove,
  onReplace,
  compact,
}: {
  images: ImageAttachment[]
  compact?: boolean
  onRemove?: (id: string) => void
  onReplace?: (id: string, next: ImageAttachment) => void
}) {
  return (
    <div data-image-attachments className="flex max-h-56 min-w-0 flex-wrap gap-2 overflow-y-auto">
      {images.map(image => (
        <ImageTile key={image.id} image={image} onRemove={onRemove} onReplace={onReplace} compact={compact} />
      ))}
    </div>
  )
}
