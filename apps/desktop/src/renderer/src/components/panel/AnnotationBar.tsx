import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { X } from 'lucide-react'
import { Button, IconButton, useComingSoon } from '@/components/ui'

interface AnnotationBarProps {
  annotations: Array<{ id: number; text: string }>
}

/** 底部批注栏：编号 + 批注文字 + 发送按钮 */
export function AnnotationBar({ annotations }: AnnotationBarProps) {
  useI18n()
  const comingSoon = useComingSoon()

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 px-3 pt-3 pb-3">
      {annotations.map((a) => (
        <div key={a.id} className="flex w-full items-center gap-2">
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-meta font-semibold tabular-nums text-accent-on">
            {a.id}
          </span>
          <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-line bg-surface px-2.5 text-list text-fg shadow-sm">
            <span className="truncate">{a.text}</span>
          </div>
          <IconButton icon={X} label={tr("panel.AnnotationBar.message76")} onClick={() => comingSoon(tr("panel.AnnotationBar.message76"))} />
        </div>
      ))}
      <Button variant="outline" onClick={() => comingSoon(tr("panel.AnnotationBar.message77"))}>{tr("panel.AnnotationBar.message77")} </Button>
    </div>
  )
}
