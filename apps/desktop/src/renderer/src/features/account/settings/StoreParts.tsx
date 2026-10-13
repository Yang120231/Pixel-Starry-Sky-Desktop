import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/ui'
import type { StoreLinkKind, StoreLinkParams } from '../../../../../shared/types/account'

/** 打开面板页：成功后页面上出现「在浏览器里完成付款后回到这里」 */
export type OpenStore = (kind: StoreLinkKind, params?: StoreLinkParams) => void

/** 「打开网页面板」按钮：空状态用 */
export function OpenPanelButton({ onOpen }: { onOpen: OpenStore }) {
  useI18n()
  return (
    <Button variant="outline" icon={ExternalLink} className="mt-4" onClick={() => onOpen('purchase')}>
      {tr('settings.account.Store.openPanel')}
    </Button>
  )
}
