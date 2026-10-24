// 会话页右上角（docs/mobile-remote.md §21.4、§17.3 第 15 项）：「+」在这个项目里新建对话；「⋯」里是重命名、置顶、归档，
// 和这个项目的改动 / 文件 / Git（工具页由 App 打开，宽屏放右栏）。旧版电脑不认这些通道时显示它的报错。
// 置顶、归档的错误由会话页显示在输入框上面；重命名的错误显示在重命名面板里（不然被面板挡住）。
import { useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import type { SessionRecord } from '@pixelsky/protocol'
import type { DesktopLink } from '@/connection'
import type { ToolId } from '@/data/tools'
import { L } from '@/i18n'
import { Button, IconButton, Spinner } from '@/ui'
import { ActionSheet, Sheet, type SheetAction } from '@/ui/sheet'

export const menuError = (e: unknown): string => {
  const code = (e as Error).message
  switch (code) {
    case 'MOBILE_FORBIDDEN':
      return L('这部手机是「只看」，改不了。', "This phone is set to “View only” and can't change this.")
    case 'MOBILE_UNSUPPORTED':
      return L(
        '电脑上的像素星空版本较旧，先更新电脑版。',
        'The PixelSky app on your computer is out of date. Update it first.',
      )
    case 'MOBILE_BAD_ARGUMENT':
      return L('电脑不接受这个名字。', "The computer didn't accept this name.")
    case 'SESSION_RUNNING':
      return L('这个会话还在运行。', 'This conversation is still running.')
    default:
      return code
  }
}

export function SessionMenu({
  link,
  record,
  canAct,
  running,
  onNew,
  onTool,
  onArchived,
  onError,
}: {
  link: DesktopLink | undefined
  record: SessionRecord | undefined
  canAct: boolean
  running: boolean
  onNew?(projectId: string): void
  onTool?(tool: ToolId, projectId: string): void
  /** 归档了：回到列表 */
  onArchived?(): void
  onError(message: string | null): void
}) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  if (!record) return <span className="w-11 shrink-0 min-[900px]:w-6" />

  // 成功返回 null，失败返回错误码（调用方决定显示在哪）
  const send = async (method: string, ...args: unknown[]): Promise<string | null> => {
    if (!link) return 'MOBILE_UNSUPPORTED'
    try {
      await link.call(method, record.id, ...args)
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  const call = async (method: string, ...args: unknown[]) => {
    onError(null)
    const code = await send(method, ...args)
    if (code) onError(menuError(new Error(code)))
    return !code
  }
  const archive = async () => {
    const stop =
      running &&
      confirm(L('这个会话还在运行。停止并归档？', 'This conversation is still running. Stop and archive it?'))
    if (running && !stop) return
    if (
      !running &&
      !confirm(
        L(
          '归档这个会话？以后可以在电脑上找回。',
          'Archive this conversation? You can restore it on the computer later.',
        ),
      )
    )
      return
    onError(null)
    let code = await send('engine:archiveSession', true, stop)
    // 手机上看着没在跑，电脑上其实在启动、在投递队列里的消息：再问一次要不要停止
    if (
      code === 'SESSION_RUNNING' &&
      confirm(
        L(
          '电脑上这个会话还在运行。停止并归档？',
          'This conversation is still running on the computer. Stop and archive it?',
        ),
      )
    )
      code = await send('engine:archiveSession', true, true)
    if (!code) onArchived?.()
    else if (code !== 'SESSION_RUNNING') onError(menuError(new Error(code)))
  }
  const actions: SheetAction[] = [
    { label: L('重命名', 'Rename'), disabled: !canAct, onSelect: () => setRenaming(true) },
    {
      label: record.pinnedAt ? L('取消置顶', 'Unpin') : L('置顶', 'Pin'),
      disabled: !canAct,
      onSelect: () => void call('engine:setSessionPinned', !record.pinnedAt),
    },
    ...(onTool
      ? [
          {
            label: L('这个项目的改动', 'Changes in this project'),
            onSelect: () => onTool('artifacts', record.projectId),
          },
          { label: L('文件', 'Files'), onSelect: () => onTool('files', record.projectId) },
          { label: 'Git', onSelect: () => onTool('git', record.projectId) },
        ]
      : []),
    { label: L('归档', 'Archive'), danger: true, disabled: !canAct, onSelect: () => void archive() },
  ]

  return (
    <div className="flex shrink-0 items-center">
      {onNew && (
        <IconButton
          label={L('在这个项目里新建对话', 'New conversation in this project')}
          icon={Plus}
          disabled={!canAct}
          onClick={() => onNew(record.projectId)}
          className="disabled:opacity-40"
        />
      )}
      <IconButton label={L('更多', 'More')} icon={MoreHorizontal} onClick={() => setMenu(true)} />
      {menu && (
        <ActionSheet
          title={record.title || L('会话', 'Conversation')}
          actions={actions}
          onClose={() => setMenu(false)}
        />
      )}
      {renaming && (
        <RenameSheet
          title={record.title}
          onClose={() => setRenaming(false)}
          onSave={async title => {
            const code = await send('engine:renameSession', title)
            if (!code) setRenaming(false)
            return code && menuError(new Error(code))
          }}
        />
      )}
    </div>
  )
}

function RenameSheet({
  title,
  onSave,
  onClose,
}: {
  title: string
  /** 返回错误文字；成功时 null（面板由调用方关掉） */
  onSave(title: string): Promise<string | null>
  onClose(): void
}) {
  const [value, setValue] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = value.trim()
  const save = async () => {
    if (!clean || clean === title || busy) return
    setBusy(true)
    setError(null)
    setError(await onSave(clean))
    setBusy(false)
  }
  return (
    <Sheet
      title={L('重命名', 'Rename')}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 p-3">
          {error && <p className="px-1 text-meta text-danger">{error}</p>}
          <Button
            variant="primary"
            className="w-full"
            disabled={!clean || clean === title || busy}
            onClick={() => void save()}
          >
            {busy && <Spinner size={14} />}
            {L('保存', 'Save')}
          </Button>
        </div>
      }
    >
      <div className="p-4">
        <input
          value={value}
          autoFocus
          maxLength={200}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && void save()}
          className="min-h-11 w-full rounded-xl border border-line-composer bg-surface px-3 text-prose outline-none focus:border-line-composer-focus"
        />
      </div>
    </Sheet>
  )
}
