import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { pickByDigit } from './menuDigit'
import { useRestoreFocus } from './useRestoreFocus'

export interface MenuAction {
  label: string
  /** 有 children 时不用（点了打开子菜单） */
  run?(): void
  disabled?: boolean
  danger?: boolean
  /** 左侧图标 */
  icon?: LucideIcon
  /** 设置后成为可勾选项（menuitemcheckbox），为真时右侧打勾 */
  checked?: boolean
  /** 在这一项前面插入分组小标题 */
  section?: string
  /** 在这一项前面画一条分隔线（没有标题） */
  separator?: boolean
  /** 鼠标提示（不可点时说明原因） */
  title?: string
  /** 右侧淡色小字（快捷键、符号提示） */
  hint?: string
  /** 子菜单（docs/ui/ui-polish-2026-10-13.md §4）：悬停、→ 或回车打开，← 或 Esc 回到这一项 */
  children?: MenuAction[]
}

const PANEL =
  'pop-in no-drag fixed z-[70] max-h-[calc(100vh-16px)] min-w-48 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu'

/** 浮层摆进窗口里：放不下就往回收 */
function place(el: HTMLElement, x: number, y: number, flipFrom?: number): void {
  const rect = el.getBoundingClientRect()
  // 子菜单右边放不下时翻到父菜单左边
  const left = flipFrom !== undefined && x + rect.width > innerWidth - 8 ? flipFrom - rect.width : x
  el.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`
}

const enabledItems = (root: HTMLElement | null): HTMLButtonElement[] => [
  ...(root?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled), :scope > * > button:not(:disabled)') ??
    []),
]

/** 上下 / Home / End 在菜单项之间移动；返回是否处理了 */
function moveFocus(e: KeyboardEvent, root: HTMLElement | null): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false
  e.preventDefault()
  const items = enabledItems(root)
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
  return true
}

/** Shared context menu, outside scroll containers, with keyboard navigation (arrows, Home / End, 1–9). */
export function ActionMenu({
  x,
  y,
  label,
  actions,
  onClose,
}: {
  x: number
  y: number
  label: string
  actions: MenuAction[]
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null),
    subRef = useRef<HTMLDivElement>(null),
    close = useRef(onClose)
  close.current = onClose
  useRestoreFocus(true)
  // 打开的子菜单：哪一项、父项的位置、是不是用键盘打开的（是就把焦点放进去）
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; focus: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    place(el, x, y)
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !subRef.current?.contains(target)) close.current()
    }
    const hide = () => close.current()
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])
  const button = (index: number): HTMLButtonElement | null =>
    ref.current?.querySelector<HTMLButtonElement>(`[data-menu-index="${index}"]`) ?? null
  const openSub = (index: number, focus: boolean): void => {
    const el = button(index)
    if (el) setSub({ index, rect: el.getBoundingClientRect(), focus })
  }
  const closeSub = (refocus: boolean): void => {
    const index = sub?.index
    setSub(null)
    if (refocus && index !== undefined) button(index)?.focus()
  }
  const children = sub ? actions[sub.index]?.children : undefined
  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className={PANEL}
        style={{ left: x, top: y }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            onClose()
            return
          }
          if (moveFocus(e, ref.current) || pickByDigit(e.nativeEvent, enabledItems(ref.current))) return
          const index = Number((document.activeElement as HTMLElement | null)?.dataset.menuIndex)
          if (e.key === 'ArrowRight' && actions[index]?.children) {
            e.preventDefault()
            openSub(index, true)
          }
        }}
      >
        <Items
          actions={actions}
          openIndex={sub?.index ?? null}
          onHover={index => (actions[index]?.children ? openSub(index, false) : sub && setSub(null))}
          onPick={(action, index) => {
            if (action.children) {
              openSub(index, true)
              return
            }
            onClose()
            action.run?.()
          }}
        />
      </div>
      {sub && children && (
        <SubMenu
          menuRef={subRef}
          rect={sub.rect}
          focus={sub.focus}
          label={actions[sub.index].label}
          actions={children}
          onBack={() => closeSub(true)}
          onClose={onClose}
        />
      )}
    </>,
    document.body,
  )
}

function SubMenu({
  menuRef,
  rect,
  focus,
  label,
  actions,
  onBack,
  onClose,
}: {
  menuRef: RefObject<HTMLDivElement | null>
  rect: DOMRect
  focus: boolean
  label: string
  actions: MenuAction[]
  onBack(): void
  onClose(): void
}) {
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    place(el, rect.right + 2, rect.top - 5, rect.left - 2)
    if (focus) el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menuRef, rect, focus])
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={PANEL}
      style={{ left: rect.right + 2, top: rect.top - 5 }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === 'ArrowLeft') {
          e.preventDefault()
          onBack()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onClose()
        } else if (!moveFocus(e, menuRef.current)) pickByDigit(e.nativeEvent, enabledItems(menuRef.current))
      }}
    >
      <Items
        actions={actions}
        openIndex={null}
        onHover={() => undefined}
        onPick={action => {
          onClose()
          action.run?.()
        }}
      />
    </div>
  )
}

function Items({
  actions,
  openIndex,
  onHover,
  onPick,
}: {
  actions: MenuAction[]
  openIndex: number | null
  onHover(index: number): void
  onPick(action: MenuAction, index: number): void
}) {
  return actions.map((action, index) => {
    const Icon = action.icon
    return (
      <Fragment key={`${index}:${action.label}`}>
        {action.section && (
          <div
            role="presentation"
            className={cn('px-3 pb-1 text-label text-fg-faint', index > 0 ? 'mt-1 border-t border-line pt-2' : 'pt-1')}
          >
            {action.section}
          </div>
        )}
        {action.separator && !action.section && index > 0 && (
          <div role="separator" className="mx-2 my-1 border-t border-line" />
        )}
        <button
          type="button"
          role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={action.checked}
          aria-haspopup={action.children ? 'menu' : undefined}
          aria-expanded={action.children ? openIndex === index : undefined}
          data-menu-index={index}
          disabled={action.disabled}
          title={action.title}
          className={cn(
            'flex min-h-8 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-ui hover:bg-hover disabled:opacity-40',
            action.danger ? 'text-danger' : 'text-fg',
            openIndex === index && 'bg-hover',
          )}
          onPointerEnter={() => onHover(index)}
          onClick={() => onPick(action, index)}
        >
          {Icon && <Icon size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />}
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          {action.hint && <span className="shrink-0 text-meta text-fg-faint">{action.hint}</span>}
          {action.checked && <Check size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
          {action.children && <ChevronRight size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
        </button>
      </Fragment>
    )
  })
}
