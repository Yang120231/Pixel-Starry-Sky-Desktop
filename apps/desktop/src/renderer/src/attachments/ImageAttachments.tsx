import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ImageAttachment } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { imageBlob, imageSize } from './images'

function ImageTile({ image, onRemove }: { image: ImageAttachment; onRemove?: (id: string) => void }) {
  useI18n()
  const [url, setUrl] = useState(''),
    [open, setOpen] = useState(false)
  const popup = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(imageBlob(image))
    setUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image.id, image.dataBase64, image.mediaType])
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    popup.current?.focus()
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      ;(before?.isConnected ? before : trigger.current)?.focus()
    }
  }, [open])
  const description = `${image.name} · ${image.width}×${image.height} · ${imageSize(image.bytes)}`
  return (
    <>
      <div
        data-image-attachment={image.id}
        className="group relative h-24 w-24 overflow-hidden rounded-lg border border-line-card bg-subtle"
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
        <span className="pointer-events-none absolute right-0 bottom-0 left-0 truncate border-t border-line-card bg-popover px-1 py-0.5 text-label text-fg-secondary">
          {image.name}
        </span>
      </div>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="dialog"
            aria-modal="true"
            aria-label={tr('composer.attachment.preview')}
            tabIndex={-1}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-scrim p-6 outline-none"
            onClick={event => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
            onKeyDown={event => {
              if (event.key === 'Tab') {
                event.preventDefault()
                popup.current?.querySelector<HTMLButtonElement>('button')?.focus()
              }
            }}
          >
            <div className="flex max-h-full max-w-full flex-col overflow-hidden rounded-xl border border-line-card bg-popover shadow-popover">
              <div className="flex shrink-0 items-center gap-3 px-4 py-2 text-meta text-fg-secondary">
                <span className="min-w-0 flex-1 truncate" title={description}>
                  {description}
                </span>
                <button
                  type="button"
                  aria-label={tr('composer.attachment.closePreview')}
                  onClick={() => setOpen(false)}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-hover"
                >
                  <X size={16} />
                </button>
              </div>
              {url && <img src={url} alt={image.name} className="min-h-0 max-h-[80vh] max-w-[90vw] object-contain" />}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
export function ImageAttachments({ images, onRemove }: { images: ImageAttachment[]; onRemove?: (id: string) => void }) {
  return (
    <div data-image-attachments className="flex max-h-56 min-w-0 flex-wrap gap-2 overflow-y-auto">
      {images.map(image => (
        <ImageTile key={image.id} image={image} onRemove={onRemove} />
      ))}
    </div>
  )
}
