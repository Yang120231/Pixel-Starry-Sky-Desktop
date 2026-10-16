import { useState } from 'react'
import type { ExtPackContributionKind, ExtPackInfo } from '@pixelsky/protocol'
import { packDescription } from '@pixelsky/protocol'
import { cn, Switch } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { packAssetUrl } from '@/features/extpacks/store'
import { KIND_ORDER, packTitle } from './model'
import { PackBadge } from './PackBadge'

const CHIP_KEYS = {
  grammars: 'extensions.chip.grammars',
  themes: 'extensions.chip.themes',
  snippets: 'extensions.chip.snippets',
  iconThemes: 'extensions.chip.iconThemes',
  taskTemplates: 'extensions.chip.taskTemplates',
  skills: 'extensions.chip.skills',
  prompts: 'extensions.chip.prompts',
} as const satisfies Record<ExtPackContributionKind, string>

/**
 * 扩展图标：清单里的 icon，没有就用名字首字母。
 * 商店目录里的扩展还没装、没有 pack，传 src（pixelsky-ext://store-icon/…）和 name；图片加载失败也退回首字母
 */
export function PackIcon({
  pack,
  size = 32,
  src,
  name,
}: {
  pack?: ExtPackInfo
  size?: number
  src?: string
  name?: string
}) {
  const { locale } = useI18n()
  const [failed, setFailed] = useState<string | null>(null)
  const icon = pack?.manifest?.icon
  const style = { width: size, height: size }
  const url = src ?? (pack && icon && pack.status !== 'error' ? packAssetUrl(pack.key, icon) : undefined)
  if (url && failed !== url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className="shrink-0 rounded-md"
        style={style}
        onError={() => setFailed(url)}
      />
    )
  }
  const title = name ?? (pack ? packTitle(pack, locale) : '')
  return (
    <span
      aria-hidden
      style={style}
      className="flex shrink-0 items-center justify-center rounded-md bg-avatar text-ui font-medium text-avatar-fg"
    >
      {/* 跳过开头的符号：「.env 文件支持」显示 E 而不是「.」 */}
      {(title.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function PackStatus({ pack }: { pack: ExtPackInfo }) {
  const { t } = useI18n()
  if (pack.status === 'error') return <PackBadge tone="danger">{t('extensions.status.error')}</PackBadge>
  if (pack.status === 'warning') {
    const n = pack.issues.filter(i => i.severity === 'warning').length
    return <PackBadge tone="warn">{tr('extensions.status.warnings', { n })}</PackBadge>
  }
  return null
}

export function PackList({
  packs,
  selected,
  onSelect,
  busy,
  onToggle,
}: {
  packs: ExtPackInfo[]
  selected: string | null
  onSelect(key: string): void
  busy: boolean
  onToggle(key: string, enabled: boolean): void
}) {
  const { locale, t } = useI18n()
  return (
    <ul className="divide-y divide-line-subtle rounded-lg border border-line">
      {packs.map(pack => {
        const title = packTitle(pack, locale)
        const counts = KIND_ORDER.map(kind => [kind, pack.manifest?.contributes[kind]?.length ?? 0] as const).filter(
          ([, n]) => n > 0,
        )
        return (
          <li
            key={pack.key}
            data-pack-key={pack.key}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg hover:bg-hover',
              selected === pack.key && 'bg-selected',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(pack.key)}
              className="no-drag flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <PackIcon pack={pack} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-ui font-medium text-fg">{title}</span>
                  {pack.manifest && <span className="shrink-0 text-meta text-fg-faint">{pack.manifest.version}</span>}
                  {pack.source === 'builtin' ? (
                    <PackBadge>{t('extensions.badge.builtin')}</PackBadge>
                  ) : (
                    <PackBadge tone="warn">{t('extensions.badge.dev')}</PackBadge>
                  )}
                  <PackStatus pack={pack} />
                </span>
                {pack.manifest && (
                  <span className="mt-0.5 block truncate text-meta text-fg-muted">
                    {packDescription(pack.manifest, locale)}
                  </span>
                )}
                {counts.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {counts.map(([kind, n]) => (
                      <PackBadge key={kind}>{tr(CHIP_KEYS[kind], { n })}</PackBadge>
                    ))}
                  </span>
                )}
              </span>
            </button>
            <Switch
              checked={pack.enabled}
              disabled={busy || pack.status === 'error'}
              label={tr('extensions.enable', { name: title })}
              onChange={on => onToggle(pack.key, on)}
            />
          </li>
        )
      })}
    </ul>
  )
}
