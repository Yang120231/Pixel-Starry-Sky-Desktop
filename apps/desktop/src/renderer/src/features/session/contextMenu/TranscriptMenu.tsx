// 对话区右键菜单（scratch/2026-10-14-context-menu/plan.md 第一批）：
// 选中的文字（复制、引用到输入框、在旁聊里问、在对话中搜索）、整条消息、代码块、链接、文件路径。
// 挂在对话区外层，只管对话流里的右键；菜单键、Shift+F10 也能打开
import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import {
  AtSign,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderTree,
  MessageSquareQuote,
  MessagesSquare,
  Search,
  SquareCode,
  TextSelect,
} from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useToast } from '@/ui'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
import { PathLinksContext } from '@/ui/markdown/pathLinks'
import { appendComposerDraft, appendComposerInline } from '@/features/engine/drafts'
import { focusComposer } from '../composerTarget'
import { QUOTE_MAX_CHARS, QUOTE_MAX_LINES } from '../quote'
import { clipboardWrite } from './clipboard'
import {
  absolutePath,
  cleanSelection,
  fencedBlock,
  findable,
  quoteBlock,
  quoteTooLong,
  transcriptTarget,
} from './transcriptTarget'

interface Props {
  /** 对话区外层（里面有 [data-conversation-stream]） */
  root: RefObject<HTMLElement | null>
  /** 这个会话输入框的草稿键 */
  composerKey: string
  /** 会话目录（复制完整路径用） */
  cwd: string | null
  items: readonly Item[] | undefined
  /** 打开对话内搜索（选区还在，搜索框会直接拿它当搜索词） */
  onFind(): void
  /** 打开旁聊并把文字放进旁聊输入框；不能用旁聊时为 null */
  onAskSide: ((text: string) => void) | null
  /** 旁聊暂时不能问的原因 */
  sideDisabled: string | null
}

const menuKey = (e: KeyboardEvent): boolean => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')

/** 选区在对话流里时取出文字，否则空串 */
function selectionIn(stream: Element): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !stream.contains(selection.anchorNode)) return ''
  return cleanSelection(selection.toString())
}

export function TranscriptMenu({ root, composerKey, cwd, items, onFind, onAskSide, sideDisabled }: Props) {
  useI18n()
  const toast = useToast()
  const links = useContext(PathLinksContext)
  const [menu, setMenu] = useState<{ x: number; y: number; actions: MenuAction[] } | null>(null)

  // 监听只挂一次，菜单内容每次右键时用最新的 props 现拼
  const build = (el: Element, stream: Element): MenuAction[] => {
    const copy = (text: string): void =>
      void clipboardWrite(text).then(
        () => toast(tr('ctxmenu.copied')),
        () => toast(tr('ctxmenu.copyFailed')),
      )
    // 放进输入框（引用、代码块）：和编辑器「引用到对话」同一个大小上限
    const insert = (text: string): void => {
      const big = quoteTooLong(text)
      if (big) {
        toast(tr('ctxmenu.tooLong', { ...big, maxLines: QUOTE_MAX_LINES, maxChars: QUOTE_MAX_CHARS }))
        return
      }
      appendComposerDraft(composerKey, text)
      focusComposer(composerKey)
    }
    const quote = (text: string): void => insert(quoteBlock(text))
    const actions: MenuAction[] = []
    const add = (section: string, list: MenuAction[]): void => {
      if (list.length) actions.push({ ...list[0], section }, ...list.slice(1))
    }
    const target = transcriptTarget(el)
    const selected = selectionIn(stream)

    if (selected)
      add(tr('ctxmenu.section.selection'), [
        { label: tr('ctxmenu.copy'), icon: Copy, run: () => copy(selected) },
        { label: tr('ctxmenu.quote'), icon: MessageSquareQuote, run: () => quote(selected) },
        ...(onAskSide
          ? [
              {
                label: tr('ctxmenu.askSide'),
                icon: MessagesSquare,
                disabled: !!sideDisabled,
                title: sideDisabled ?? undefined,
                run: () => onAskSide(quoteBlock(selected)),
              },
            ]
          : []),
        ...(findable(selected) ? [{ label: tr('ctxmenu.find'), icon: Search, run: onFind }] : []),
      ])

    if (target.code) {
      const { text, lang } = target.code
      add(tr('ctxmenu.section.code'), [
        { label: tr('ctxmenu.code.copy'), icon: Copy, disabled: !text, run: () => copy(text) },
        {
          label: tr('ctxmenu.code.insert'),
          icon: SquareCode,
          disabled: !text,
          run: () => insert(fencedBlock(text, lang)),
        },
      ])
    }

    if (target.link) {
      const href = target.link
      add(tr('ctxmenu.section.link'), [
        // 窗口的 setWindowOpenHandler 交给系统浏览器，只放行 http / https
        { label: tr('ctxmenu.link.open'), icon: ExternalLink, run: () => void window.open(href, '_blank') },
        { label: tr('ctxmenu.link.copy'), icon: Copy, run: () => copy(href) },
      ])
    }

    if (target.path) {
      const path = target.path
      const full = absolutePath(cwd, path.path)
      add(tr(path.folder ? 'ctxmenu.section.folder' : 'ctxmenu.section.path'), [
        // 文件夹：在文件树里显示；文件：打开
        path.folder
          ? {
              label: tr('ctxmenu.path.showInTree'),
              icon: FolderTree,
              disabled: !links?.showFolder,
              run: () => links?.showFolder?.(path.path),
            }
          : {
              label: tr('ctxmenu.path.open'),
              icon: FileText,
              disabled: !links,
              run: () => links?.open(path),
            },
        {
          label: tr('ctxmenu.path.reveal'),
          icon: FolderOpen,
          disabled: !links?.reveal,
          run: () => links?.reveal?.(path),
        },
        { label: tr('ctxmenu.path.copy'), icon: Copy, disabled: !full, run: () => full && copy(full) },
        { label: tr('ctxmenu.path.copyRelative'), icon: Copy, run: () => copy(path.path) },
        {
          label: tr('ctxmenu.path.mention'),
          icon: AtSign,
          run: () => {
            appendComposerInline(composerKey, `@${path.path} `)
            focusComposer(composerKey)
          },
        },
      ])
    }

    // 项目外的路径：不打开，只能在文件夹中显示、复制
    if (target.outside) {
      const outside = target.outside.path
      add(tr('ctxmenu.section.outside'), [
        {
          label: tr('ctxmenu.path.reveal'),
          icon: FolderOpen,
          disabled: !links?.revealOutside,
          run: () => links?.revealOutside?.(outside),
        },
        { label: tr('ctxmenu.path.copy'), icon: Copy, run: () => copy(outside) },
      ])
    }

    const item = target.item ? items?.find(i => i.id === target.item) : undefined
    if (item && (item.kind === 'user' || item.kind === 'assistant') && item.text) {
      const text = item.text
      add(tr('ctxmenu.section.message'), [
        { label: tr('ctxmenu.message.copy'), icon: Copy, run: () => copy(text) },
        { label: tr('ctxmenu.message.quote'), icon: MessageSquareQuote, run: () => quote(text) },
        {
          label: tr('ctxmenu.message.select'),
          icon: TextSelect,
          run: () => {
            const row = stream.querySelector(`[data-search-item="${CSS.escape(item.id)}"]`)
            const body = row?.querySelector('.conversation-user-bubble') ?? row?.firstElementChild
            if (!body) return
            const range = document.createRange()
            range.selectNodeContents(body)
            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range)
          },
        },
      ])
    }
    return actions
  }
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    const host = root.current
    if (!host) return
    const streamOf = (): Element | null => host.querySelector('[data-conversation-stream]')
    const open = (x: number, y: number, el: Element, stream: Element): boolean => {
      const actions = buildRef.current(el, stream)
      if (!actions.length) return false
      setMenu({ x, y, actions })
      return true
    }
    const streamRange = (stream: Element): Range | null => {
      const selection = window.getSelection()
      return selection && !selection.isCollapsed && selection.anchorNode && stream.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null
    }
    // 右键按下时浏览器可能先把选区收起来：按下时记下选区，右键点在选中的字上就在弹菜单前放回去
    let saved: Range | null = null
    const onPointerDown = (e: PointerEvent): void => {
      saved = null
      const stream = streamOf()
      const range = e.button === 2 && stream ? streamRange(stream) : null
      if (!range) return
      const hit = [...range.getClientRects()].some(
        r => e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2,
      )
      if (hit) saved = range.cloneRange()
    }
    const onContextMenu = (e: MouseEvent): void => {
      const stream = streamOf()
      const el = e.target instanceof Element ? e.target : null
      const keep = saved
      saved = null
      if (!stream || !el || !stream.contains(el) || el.closest('input, textarea, [contenteditable="true"]')) return
      const selection = window.getSelection()
      if (keep && selection?.isCollapsed) {
        selection.removeAllRanges()
        selection.addRange(keep)
      }
      if (open(e.clientX, e.clientY, el, stream)) e.preventDefault()
    }
    // 菜单键 / Shift+F10：焦点在对话流里，或者焦点不在任何地方（鼠标选完字时焦点在 body）而选区在对话流里。
    // 焦点在输入框、编辑器等别处时不管，它们有自己的菜单
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!menuKey(e) || e.defaultPrevented) return
      const stream = streamOf()
      if (!stream) return
      const focused = document.activeElement
      const idle = !focused || focused === document.body || focused === document.documentElement
      const inStream = focused instanceof Element && stream.contains(focused)
      if (!idle && !inStream) return
      const range = streamRange(stream)
      const start = range?.startContainer
      const el = inStream ? focused : start instanceof Element ? start : (start?.parentElement ?? null)
      if (!el) return
      // 有选区时开在选区下面，否则开在有焦点的元素下面
      const rect = (range ?? el).getBoundingClientRect()
      if (open(rect.left, rect.bottom + 4, el, stream)) e.preventDefault()
    }
    host.addEventListener('pointerdown', onPointerDown, true)
    host.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      host.removeEventListener('pointerdown', onPointerDown, true)
      host.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [root, buildRef])

  if (!menu) return null
  return (
    <ActionMenu
      x={menu.x}
      y={menu.y}
      label={tr('ctxmenu.transcript.label')}
      actions={menu.actions}
      onClose={() => setMenu(null)}
    />
  )
}
