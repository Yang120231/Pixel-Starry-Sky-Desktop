import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { GROUP_NAME_LIMIT } from '@/features/appearance/sidebar'

/** 新建 / 重命名分区：一个名字输入框，回车保存（docs/ui/sidebar-groups.md） */
export function GroupNameDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string
  initial: string
  onSave: (name: string) => void
  onClose: () => void
}) {
  useI18n()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const save = (): void => {
    const name = Array.from(value.trim()).slice(0, GROUP_NAME_LIMIT).join('')
    if (!name) return setError(tr('sidebar.group.nameRequired'))
    onSave(name)
    onClose()
  }
  return (
    <ConfirmDialog
      title={title}
      focusInput
      description={
        <>
          <p>{tr('sidebar.group.intro')}</p>
          <label className="mt-4 flex flex-col gap-2">
            <span>{tr('sidebar.group.name')}</span>
            <input
              data-group-name
              value={value}
              maxLength={GROUP_NAME_LIMIT * 2}
              aria-invalid={!!error}
              onChange={event => {
                setValue(event.target.value)
                setError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  save()
                }
              }}
              className="w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent-line focus:ring-2 focus:ring-composer-ring"
            />
          </label>
        </>
      }
      busy={false}
      error={error}
      confirmLabel={tr('sidebar.group.save')}
      cancelLabel={tr('sidebar.group.cancel')}
      onConfirm={save}
      onCancel={onClose}
    />
  )
}
