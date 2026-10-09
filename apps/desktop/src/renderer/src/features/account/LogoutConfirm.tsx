import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Button, cn } from '@/ui'

/** 退出登录的二次确认（2026-10-06 用户要求）。账号菜单和设置 → 账号共用 */
export function LogoutConfirm({
  onCancel,
  onConfirm,
  className,
}: {
  onCancel: () => void
  onConfirm: () => void
  className?: string
}) {
  useI18n()
  return (
    <div
      role="alertdialog"
      aria-label={tr('account.LogoutConfirm.message47')}
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="text-ui font-medium text-fg">{tr('account.LogoutConfirm.message48')}</div>
      <p className="text-meta text-fg-muted">{tr('account.LogoutConfirm.message49')}</p>
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="outline" autoFocus onClick={onCancel}>
          {tr('account.AccountMenu.message31')}{' '}
        </Button>
        <Button variant="primary" className="bg-danger!" onClick={onConfirm}>
          {tr('account.LogoutConfirm.message50')}{' '}
        </Button>
      </div>
    </div>
  )
}
