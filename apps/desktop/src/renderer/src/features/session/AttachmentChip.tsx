import { useI18n } from '@/i18n/I18nProvider'
import { Camera, Globe, Paperclip, Sparkles, type LucideIcon } from 'lucide-react'
import { Chip } from '@/ui'
import type { Attachment } from '@/data'

const ICONS: Record<Attachment['kind'], LucideIcon> = {
  browser: Globe,
  screenshot: Camera,
  file: Paperclip,
  mode: Sparkles,
}

/** 输入框里的附件 / 模式标签 */
export function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  useI18n()
  return (
    <Chip icon={ICONS[attachment.kind]} tone={attachment.kind === 'mode' ? 'accent' : 'neutral'} onRemove={onRemove}>
      {attachment.label}
    </Chip>
  )
}
