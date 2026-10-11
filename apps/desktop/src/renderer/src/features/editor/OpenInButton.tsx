// 「打开方式」（GitHub #12，docs/ui/open-with.md）：顶栏的分体按钮。左边直接用默认程序打开当前工作区，
// 右边的 ▾ 列出本机装了的编辑器、文件资源管理器和终端，标出默认的，可以改默认。图标位置里能挪走或隐藏。
import { useEffect, useState } from 'react'
import { Check, ChevronDown, FolderOpen, Settings, SquareArrowOutUpRight, SquareTerminal } from 'lucide-react'
import { cn, Popover, useToast } from '@/ui'
import { isDemo } from '@/data'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { useSettings } from '@/features/settings/SettingsProvider'
import { machineOf } from '@/features/machines/store'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import type { EditorItem, EditorState, OpenTool } from '../../../../shared/types/workspace'
import { EditorIcon, editorLabel } from './EditorIcon'
import { refreshEditors, setEditors, useEditors } from './store'
import { useActiveWorkspace } from './target'

type Choice = { kind: 'editor'; item: EditorItem } | { kind: 'tool'; tool: OpenTool }

const choiceId = (c: Choice): string => (c.kind === 'editor' ? c.item.id : c.tool.id)
/** 程序名：文件管理器和系统终端按界面语言显示，其余用程序自己的名字 */
export const toolName = (tool: OpenTool): string => {
  const platform = window.pixelsky?.platform
  if (tool.id === 'explorer')
    return tr(platform === 'darwin' ? 'openWith.finder' : platform === 'linux' ? 'openWith.files' : 'openWith.explorer')
  if (tool.id === 'terminal' && platform === 'darwin') return tr('openWith.terminal')
  return tool.name
}
const choiceName = (c: Choice): string => (c.kind === 'editor' ? editorLabel(c.item) : toolName(c.tool))

function ChoiceIcon({ choice }: { choice: Choice | null }) {
  if (!choice) return <SquareArrowOutUpRight size={16} strokeWidth={1.5} className="shrink-0" />
  if (choice.kind === 'editor') return <EditorIcon item={choice.item} />
  return choice.tool.id === 'explorer' ? (
    <FolderOpen size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
  ) : (
    <SquareTerminal size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
  )
}

/** 能选的：可用的编辑器，再是文件资源管理器和终端 */
function choices(state: EditorState | null): { editors: Choice[]; tools: Choice[] } {
  return {
    editors: (state?.items ?? []).filter(e => e.available).map(item => ({ kind: 'editor' as const, item })),
    tools: (state?.tools ?? []).map(tool => ({ kind: 'tool' as const, tool })),
  }
}

/** 直接点时用哪个：选过的；没选过用默认编辑器；都没有时为 null（点开菜单） */
export function defaultChoice(state: EditorState | null): Choice | null {
  const { editors, tools } = choices(state)
  const all = [...editors, ...tools]
  return all.find(c => choiceId(c) === state?.workspaceId) ?? all.find(c => choiceId(c) === state?.defaultId) ?? null
}

export function OpenInButton({ placement }: { placement: SidebarPlacement }) {
  useI18n()
  const toast = useToast()
  const settings = useSettings()
  const state = useEditors()
  const workspace = useActiveWorkspace()
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  // 启动后空闲时读一次（要查注册表和安装目录），点按钮时就知道默认是哪个
  useEffect(() => {
    if (state) return
    const timer = setTimeout(() => void refreshEditors().catch(() => undefined), 3000)
    return () => clearTimeout(timer)
  }, [state])
  const ref = workspace.ref
  const remote = !!ref && machineOf(ref.sessionId ?? ref.projectId) !== 'local'
  const disabledReason = !ref ? tr('openWith.noWorkspace') : remote ? tr('project.remoteUnavailable') : null
  const current = defaultChoice(state)
  const { editors, tools } = choices(state)

  const open = async (choice: Choice): Promise<void> => {
    if (!ref) return
    if (isDemo) {
      toast(tr('editor.EditorButton.demoModeCannotOpen'))
      return
    }
    setBusy(true)
    try {
      await window.pixelsky!.editor.open(ref, choiceId(choice))
      setMenu(false)
    } catch (e) {
      toast(translateMessage((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const makeDefault = async (choice: Choice): Promise<void> => {
    if (isDemo) return
    try {
      // 选编辑器时也改「默认外部编辑器」，从文件打开时一致；文件资源管理器和终端只改这个按钮
      const patch =
        choice.kind === 'editor'
          ? { workspaceId: choice.item.id, defaultId: choice.item.id }
          : { workspaceId: choice.tool.id }
      setEditors(await window.pixelsky!.editor.preferences(patch))
    } catch (e) {
      toast(translateMessage((e as Error).message))
    }
  }
  const showMenu = (): void => {
    setMenu(value => !value)
    if (!isDemo) void refreshEditors().catch(e => toast(translateMessage((e as Error).message)))
  }

  const label = disabledReason
    ? disabledReason
    : current
      ? tr('openWith.openWith', { p0: choiceName(current), p1: workspace.name })
      : tr('openWith.choose')
  const side = placement === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1'
  const align = placement === 'header' ? 'right-0' : 'left-0'

  const row = (choice: Choice) => {
    const id = choiceId(choice),
      isDefault = current && choiceId(current) === id
    return (
      <div key={id} data-open-with={id} className="group flex h-8 items-center rounded-md hover:bg-hover">
        <button
          type="button"
          disabled={busy}
          onClick={() => void open(choice)}
          title={choice.kind === 'editor' ? choice.item.path : choice.tool.path}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-ui text-fg disabled:opacity-50"
        >
          <ChoiceIcon choice={choice} />
          <span className="min-w-0 flex-1 truncate">{choiceName(choice)}</span>
        </button>
        {isDefault ? (
          <span data-open-with-default className="mr-2 flex shrink-0 items-center gap-1 text-meta text-accent-fg">
            <Check size={12} />
            {tr('openWith.default')}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void makeDefault(choice)}
            className="mr-1 shrink-0 rounded px-1.5 py-0.5 text-meta text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-active hover:text-fg focus-visible:opacity-100"
          >
            {tr('openWith.setDefault')}
          </button>
        )}
      </div>
    )
  }

  return (
    <span data-open-in className="relative inline-flex shrink-0 items-center">
      <span
        className={cn('inline-flex h-8 items-center rounded-md', menu && 'bg-active', !!disabledReason && 'opacity-40')}
      >
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={!!disabledReason || busy}
          onClick={() => (current ? void open(current) : showMenu())}
          className="press no-drag inline-flex h-8 items-center gap-1.5 rounded-l-md pr-1 pl-2 text-fg-secondary hover:bg-hover hover:text-fg disabled:hover:bg-transparent"
        >
          <ChoiceIcon choice={current} />
        </button>
        <button
          type="button"
          aria-label={tr('openWith.more')}
          title={tr('openWith.more')}
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={!!disabledReason}
          onClick={showMenu}
          className="press no-drag inline-flex h-8 w-5 items-center justify-center rounded-r-md text-fg-muted hover:bg-hover hover:text-fg disabled:hover:bg-transparent"
        >
          <ChevronDown size={13} strokeWidth={1.5} />
        </button>
      </span>
      <Popover open={menu} onClose={() => setMenu(false)} className={cn(side, align, 'max-h-96 w-64 overflow-auto')}>
        <p className="px-2 pt-1 pb-1.5 text-meta text-fg-muted">
          {tr('openWith.title', { p0: workspace.name || tr('openWith.workspace') })}
        </p>
        {editors.length > 0 && (
          <>
            <p className="px-2 pt-1 text-label font-medium text-fg-faint">{tr('openWith.editors')}</p>
            {editors.map(row)}
          </>
        )}
        {!editors.length && state && (
          <p className="px-2 py-1 text-meta text-fg-muted">{tr('editor.ExternalFileButton.noEditorDetectedSpecify')}</p>
        )}
        {tools.length > 0 && (
          <>
            <p className="px-2 pt-2 text-label font-medium text-fg-faint">{tr('openWith.tools')}</p>
            {tools.map(row)}
          </>
        )}
        {!state && <p className="px-2 py-1 text-meta text-fg-muted">{tr('openWith.detecting')}</p>}
        <div role="separator" className="my-1 border-t border-line-subtle" />
        <button
          type="button"
          onClick={() => {
            setMenu(false)
            settings.openSettings('editor')
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui text-fg-secondary hover:bg-hover hover:text-fg"
        >
          <Settings size={15} strokeWidth={1.5} />
          {tr('openWith.settings')}
        </button>
      </Popover>
    </span>
  )
}
