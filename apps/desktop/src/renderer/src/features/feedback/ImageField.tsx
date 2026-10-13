// 反馈里的截图：粘贴、拖入或选择文件，最多 FEEDBACK_LIMITS.images 张；点图片可标注（复用输入框的图片附件组件）
import { useRef, useState, type DragEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import type { ImageAttachment } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'
import { ImageAttachments } from '@/features/session/attachments/ImageAttachments'
import { readImage } from '@/features/session/attachments/images'
import { FEEDBACK_LIMITS, type FeedbackImageInput } from '../../../../shared/types/feedback'
import { errorText } from './logic'

const isImage = (file: File): boolean => file.type.startsWith('image/')

export interface FeedbackImages {
  images: ImageAttachment[]
  error: string | null
  add: (files: File[]) => void
  remove: (id: string) => void
  replace: (id: string, next: ImageAttachment) => void
  clear: () => void
  /** 表单根元素的 onPaste：剪贴板里有图片就收进来 */
  onPaste: (event: React.ClipboardEvent) => void
}

export function useFeedbackImages(): FeedbackImages {
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const count = useRef(0)
  count.current = images.length
  const add = (files: File[]): void => {
    const list = files.filter(isImage)
    if (!list.length) return
    if (count.current + list.length > FEEDBACK_LIMITS.images) {
      setError(tr('feedback.limit.images', { p0: FEEDBACK_LIMITS.images }))
      return
    }
    setError(null)
    count.current += list.length
    Promise.all(list.map(readImage)).then(
      loaded => setImages(current => [...current, ...loaded]),
      (e: unknown) => {
        count.current -= list.length
        setError(errorText(e))
      },
    )
  }
  return {
    images,
    error,
    add,
    remove: id => setImages(current => current.filter(i => i.id !== id)),
    replace: (id, next) => setImages(current => current.map(i => (i.id === id ? next : i))),
    clear: () => {
      setImages([])
      setError(null)
    },
    onPaste: event => {
      const files = [...event.clipboardData.files].filter(isImage)
      if (!files.length) return
      event.preventDefault()
      add(files)
    },
  }
}

export const toImageInputs = (images: ImageAttachment[]): FeedbackImageInput[] =>
  images.map(i => ({ name: i.name, mediaType: i.mediaType, data: i.dataBase64 }))

export function ImageField({ state, hint = true }: { state: FeedbackImages; hint?: boolean }) {
  useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const full = state.images.length >= FEEDBACK_LIMITS.images
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    state.add([...event.dataTransfer.files])
  }
  return (
    <div
      data-feedback-images
      onDragOver={e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn('rounded-md', dragging && 'bg-accent-soft outline-2 outline-dashed outline-accent')}
    >
      {hint && (
        <p className="mb-2 text-meta text-fg-muted">
          <span className="font-medium text-fg">{tr('feedback.attach.images')}</span>{' '}
          {tr('feedback.attach.imagesHint', { p0: FEEDBACK_LIMITS.images })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {state.images.length > 0 && (
          <ImageAttachments images={state.images} onRemove={state.remove} onReplace={state.replace} />
        )}
        {!full && (
          <button
            type="button"
            aria-label={tr('feedback.attach.addImage')}
            title={tr('feedback.attach.addImage')}
            onClick={() => input.current?.click()}
            className="press flex size-10 items-center justify-center rounded-md border border-dashed border-line-strong text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ImagePlus size={16} strokeWidth={1.5} />
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={e => {
            state.add([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      {state.error && <p className="selectable mt-1.5 text-meta text-danger">{state.error}</p>}
    </div>
  )
}
