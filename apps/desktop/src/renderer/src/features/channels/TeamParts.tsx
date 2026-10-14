// 团队界面的小零件：角色名、带在线点的头像（docs/ui/channels-phase-c.md §3）
import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '../../i18n/core'
import { Avatar, cn, type SelectOption } from '@/ui'
import type { TeamRole } from '../../../../shared/types/channels'

const ROLE_KEY: Record<TeamRole, TranslationKey> = {
  owner: 'team.role.owner',
  member: 'team.role.member',
  observer: 'team.role.observer',
}

export const roleLabel = (role: TeamRole): string => tr(ROLE_KEY[role])

/** 邀请 / 改角色时可选的角色（所有者只有一个，不能选） */
export function roleOptions(): SelectOption<Exclude<TeamRole, 'owner'>>[] {
  return [
    { value: 'member', label: roleLabel('member') },
    { value: 'observer', label: roleLabel('observer') },
  ]
}

/** 在线是主色小圆点；不在线不画点（也可以用 offlineDot 画灰点） */
export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  useI18n()
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', online ? 'bg-accent' : 'border border-line-strong', className)}
    />
  )
}

/** 圆形首字头像，右下角叠在线点 */
export function PresenceAvatar({
  name,
  online,
  size = 24,
  className,
}: {
  name: string
  online?: boolean
  size?: number
  className?: string
}) {
  useI18n()
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar name={name} size={size} />
      {online !== undefined && (
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface',
            online ? 'bg-accent' : 'bg-fg-faint',
          )}
        />
      )}
    </span>
  )
}
