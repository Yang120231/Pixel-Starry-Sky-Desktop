import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useCallback, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import { useAccount } from '@/features/account'
import { AccountMenu } from '@/features/account/AccountMenu'
import { Avatar, cn } from '@/ui'
import { SIDEBAR_ROW_LIMIT, useSidebarPrefs } from '@/features/appearance/sidebar'
import { LayoutActionButton } from '@/features/layout/LayoutActionButton'
import { UpdateNotice } from '@/features/update/UpdateNotice'
import type { SidebarActionCallbacks } from './SidebarActionButton'

/**
 * 固定底部工具栏：账号（头像 + 名字 + 余额）在左并占满剩余宽度，用户选择的动作整体靠右。
 * 工具多时先收起余额行，排满时只留头像。
 * 菜单向上弹出、宽度与侧边栏内容相同，因为外层 CollapsibleSlot 会裁掉超出侧边栏的部分。
 */
export function SidebarFooter({ onAddProject, onNewTask }: SidebarActionCallbacks) {
  useI18n()
  const acc = useAccount()
  const { layout } = useSidebarPrefs()
  const [open, setOpen] = useState(false)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    accountButtonRef.current?.focus({ preventScroll: true })
  }, [])

  const name = acc.user?.name ?? null
  // 没登录时说清楚这是平台账号、只有用平台额度才需要：自己的 Claude Code / Codex 不用登录（docs/ui/workbench-ux-3.md §2.4）
  const subtitle =
    acc.status === 'signed-in'
      ? tr('sidebar.SidebarFooter.balance', { p0: acc.balanceText ?? '—' })
      : acc.status === 'signing-in'
        ? tr('sidebar.SidebarFooter.signingIn')
        : acc.status === 'loading'
          ? tr('account.AccountMenu.loadingAccount')
          : tr('sidebar.SidebarFooter.notSignedInShort')
  const title = name ?? tr('sidebar.SidebarFooter.platformAccount')
  // 侧栏窄，第二行只写「未登录 · 可选」，鼠标提示里写全
  const accountLabel = [
    title,
    acc.status === 'signed-out' ? tr('sidebar.SidebarFooter.notSignedInOptional') : subtitle,
  ].join('\n')
  const tools = layout.bottom.length
  const showText = tools < SIDEBAR_ROW_LIMIT
  const showSubtitle = tools < 4

  return (
    <footer className="relative shrink-0 px-2 py-2">
      <UpdateNotice />
      <div className="flex items-center gap-1" data-sidebar-footer>
        <button
          ref={accountButtonRef}
          type="button"
          aria-label={accountLabel}
          title={accountLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          data-sidebar-account
          // 菜单打开时，避免 mousedown 先关闭再被 click 重新打开
          onMouseDown={e => open && e.stopPropagation()}
          onClick={() => setOpen(v => !v)}
          className={cn(
            'press no-drag flex h-10 min-w-8 items-center gap-2 rounded-md px-1 text-left text-fg-muted hover:bg-hover hover:text-fg',
            showText ? 'min-w-0 flex-1' : 'shrink-0 justify-center',
            open && 'bg-selected text-fg hover:bg-selected',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            {name ? <Avatar name={name} size={24} /> : <UserRound size={16} strokeWidth={1.5} />}
          </span>
          {showText && (
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-ui text-fg">{title}</span>
              {showSubtitle && <span className="truncate text-meta text-fg-muted">{subtitle}</span>}
            </span>
          )}
        </button>
        {!showText && <div className="min-w-0 flex-1" />}
        {layout.bottom.map(action => (
          <LayoutActionButton
            key={action}
            action={action}
            placement="bottom"
            onAddProject={onAddProject}
            onNewTask={onNewTask}
          />
        ))}
      </div>
      <AccountMenu open={open} onClose={close} className="right-2 bottom-full left-2 mb-1 w-auto!" />
    </footer>
  )
}
