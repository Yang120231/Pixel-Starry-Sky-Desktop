import { MessageSquareText, X } from 'lucide-react'
import { MAX_IMAGE_COUNT, type ImageAttachment } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { IconButton } from '@/ui'
import { notesRoute, urlHost } from '@/features/panel/annotationText'
import { ImageAttachments } from './ImageAttachments'
import type { AnnotationDraft } from './annotationDraft'

/** 输入框里的网页批注附件卡（docs/ui/element-annotation.md）：N 条批注 · 路由，含截图缩略图 */
export function AnnotationCard({
  draft,
  slash,
  onReplace,
  onRemove,
}: {
  draft: AnnotationDraft
  /** 输入框里写的是斜杠命令：批注不会一起发，提示改成不带命令再发 */
  slash: boolean
  onReplace: (id: string, next: ImageAttachment) => void
  onRemove: () => void
}) {
  useI18n()
  const route = notesRoute(draft.notes) || urlHost(draft.notes[0]?.url ?? draft.url)
  const shots = draft.shots.slice(0, MAX_IMAGE_COUNT)
  return (
    <div
      data-annotation-card
      className="flex flex-col gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-2 py-1.5"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent-fg">
          <MessageSquareText size={15} />
        </span>
        <div className="min-w-0 flex-1 text-list">
          <b className="block truncate font-semibold text-fg">
            {tr('projectTools.annotationCard.title', { p0: draft.notes.length, p1: route })}
          </b>
          <span className="block truncate text-meta text-fg-muted">
            {shots.length
              ? tr('projectTools.annotationCard.shots', { p0: urlHost(draft.url), p1: shots.length })
              : urlHost(draft.url)}
          </span>
        </div>
        {shots.length > 0 && <ImageAttachments images={shots} compact onReplace={onReplace} />}
        <IconButton
          size={24}
          iconSize={12}
          icon={X}
          label={tr('projectTools.annotationCard.remove')}
          onClick={onRemove}
        />
      </div>
      {slash && <p className="text-meta text-warn">{tr('projectTools.annotationCard.hint')}</p>}
    </div>
  )
}
