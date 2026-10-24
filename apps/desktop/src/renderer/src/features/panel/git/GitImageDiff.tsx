import { ImagePreview } from '@/features/editor/ImagePreview'
import { cn } from '@/ui'
import { tr } from '@/i18n/core'
import type { GitDiff } from '../../../../../shared/types/project-tools'

/** 两端各自保留缩放和位置；新增 / 删除明确显示缺失的一端。 */
export function GitImageDiff({ diff, mode, id }: { diff: GitDiff; mode: 'inline' | 'split'; id: string }) {
  return (
    <div data-git-image-diff={mode} className={cn('flex min-h-0 flex-1', mode === 'split' ? 'flex-row' : 'flex-col')}>
      {(['original', 'modified'] as const).map((side, index) => {
        const image = diff.images?.[side]
        const label = tr(side === 'original' ? 'git.diff.image.before' : 'git.diff.image.after')
        return (
          <section
            key={side}
            aria-label={label}
            data-git-image-side={side}
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col',
              index > 0 && (mode === 'split' ? 'border-l border-line-subtle' : 'border-t border-line-subtle'),
            )}
          >
            <div className="shrink-0 border-b border-line-subtle bg-subtle px-3 py-1 text-meta text-fg-secondary">
              {label}
            </div>
            {image ? (
              <ImagePreview
                id={`${id}:${side}`}
                src={image.dataUrl}
                name={`${diff.path} · ${label}`}
                bytes={image.bytes}
              />
            ) : (
              <p className="flex flex-1 items-center justify-center p-6 text-meta text-fg-muted">
                {tr(side === 'original' ? 'git.diff.image.added' : 'git.diff.image.deleted')}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
