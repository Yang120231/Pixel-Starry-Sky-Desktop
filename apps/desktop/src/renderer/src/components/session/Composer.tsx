import { translateMessage } from '../../i18n/core'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, Mic, Plus, ShieldOff, Square } from 'lucide-react'
import { IconButton, cn, useComingSoon } from '@/components/ui'
import { attachments as initialAttachments, composer } from '@/mock/data'
import {
  SOURCE_ACTION_EVENT,
  useDemoSourceController,
  type ComposerController,
  type SourceAction,
  type StatusBarController,
} from '@/engine'
import { MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL } from '@pixelsky/protocol'
import { useAccount } from '@/account/useAccount'
import type { CreditSource } from '@/account/platform'
import { useSettings } from '@/settings/SettingsProvider'
import { AttachmentChip } from './AttachmentChip'
import { EffortMenu, PermissionMenu } from './ComposerMenus'
import { ModelSourceMenu } from './ModelSourceMenu'
import { SourceHintBar } from './SourceHintBar'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { setLayoutSize, useLayoutSize } from '@/layout/sizes'
import { useComposerDraft } from '@/engine/drafts'
import { QueuedMessages } from './QueuedMessages'
import { ContextWindowButton } from './ContextWindowButton'
import { useComposerStyle } from '@/settings/composerStyle'
import { ComposerStatusBar } from './ComposerStatusBar'
import { useI18n } from '@/i18n/I18nProvider'
import { useCommands } from '@/settings/plugins/useCommands'
import { CommandMenu } from './CommandMenu'
import { tr } from '../../i18n/core'
import { ImageAttachments } from '@/attachments/ImageAttachments'
import { readImage } from '@/attachments/images'
import { updateImages, useImageDraft } from '@/attachments/drafts'
import { Popover, PopoverItem } from '@/components/ui'

/** text-prose 是 14px / 1.7，行高取整成 24px，增高计算和样式共用 */
const LINE_HEIGHT = 24
const MAX_ROWS = 8
/** 输入区上下内边距（pt-3.5 + pb-3.5） */
export const CARD_STYLE =
  'composer-card rounded-2xl border border-line-composer bg-surface shadow-composer transition-[border-color,box-shadow] duration-(--dur-base) ease-(--ease-out) focus-within:border-line-composer-focus focus-within:ring-2 focus-within:ring-composer-ring'
/**
 * 输入框：附件与文本、发送 / 停止；设置工具行在框外。
 * 传入 live（引擎的真实逻辑）时能真正发送，Enter 发送、Shift+Enter 换行，运行中发送键变成停止键；
 * 不传（演示模式）时按钮只提示「即将推出」。
 */
export function Composer({
  live,
  status,
  autoFocus,
  draftKey,
}: {
  live?: ComposerController
  status?: StatusBarController
  autoFocus?: boolean
  draftKey?: string
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const { text: translate } = useI18n()
  const style = useComposerStyle()
  const chatgpt = style === 'chatgpt'
  const paddingY = chatgpt ? 22 : 28
  const [items, setItems] = useState(initialAttachments)
  const key = draftKey ?? live?.sessionId ?? (live ? 'new-session' : 'demo')
  const imageDraft = useImageDraft(key)
  const images = imageDraft.images
  const [reading, setReading] = useState(0)
  const adding = useRef(Promise.resolve())
  const pendingReads = useRef(0)
  const [draggingImages, setDraggingImages] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useComposerDraft(key)
  const submission = useRef<{ text: string; images: string; id: string } | null>(null)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const composerHeight = useLayoutSize('composerHeight')
  const [maxHeight, setMaxHeight] = useState(LINE_HEIGHT * MAX_ROWS + paddingY)
  const [cardWidth, setCardWidth] = useState(0)
  const [textHeight, setTextHeight] = useState(56)
  // 引擎 / 额度来源 / 模型菜单；已开始的会话切换平台 ↔ 自有前先确认（docs/ui/source-switch.md §3.4）
  const [menuOpen, setMenuOpen] = useState(false)
  const [addMenu, setAddMenu] = useState(false)
  const [confirmSource, setConfirmSource] = useState<CreditSource | null>(null)
  const account = useAccount()
  const settings = useSettings()
  const demoSource = useDemoSourceController()
  const commands = useCommands(live?.sessionId, live?.engine?.id),
    listId = useId()
  const [commandIndex, setCommandIndex] = useState(0),
    [commandDismissed, setCommandDismissed] = useState(false)
  const commandQuery = /^[/$]([^\s]*)$/.exec(text)?.[1].toLowerCase()
  const commandPrefix = text[0]
  const commandMatches = useMemo(
    () =>
      commandQuery !== undefined && !commandDismissed
        ? commands.filter(
            command =>
              (commandPrefix === '$' ? command.invocation === 'skill' : command.invocation !== 'skill') &&
              command.name.toLowerCase().includes(commandQuery),
          )
        : [],
    [commands, commandQuery, commandDismissed, commandPrefix],
  )
  const activeCommandIndex = Math.min(commandIndex, Math.max(0, commandMatches.length - 1))
  useEffect(() => {
    setCommandIndex(0)
    setCommandDismissed(false)
  }, [text])
  useEffect(() => {
    setCommandIndex(index => Math.min(index, Math.max(0, commandMatches.length - 1)))
  }, [commandMatches])
  const chooseCommand = (index: number): void => {
    const command = commandMatches[index]
    if (command) {
      setText((command.invocation === 'skill' ? '$' : '/') + command.name + ' ')
      setCommandDismissed(true)
      ref.current?.focus()
    }
  }

  const requestSource = (next: CreditSource): void => {
    if (!live || next === live.source) return
    if (live.started) setConfirmSource(next)
    else void live.setSource(next).catch((e: unknown) => setError((e as Error).message))
  }

  // 换会话时收起确认
  const sessionId = live?.sessionId ?? null
  useEffect(() => setConfirmSource(null), [sessionId])

  // 对话流里错误卡片的按钮（engine/sourceActions.ts）：只处理发给这个会话的
  const actionRef = useRef<(a: SourceAction) => void>(() => undefined)
  actionRef.current = a => {
    if (a === 'open-menu') setMenuOpen(true)
    else if (a === 'use-self') requestSource('self')
    else if (a === 'use-platform') requestSource('platform')
    else if (a === 'open-account') settings.openSettings('account')
    else if (a === 'sign-in') void account.login()
  }
  useEffect(() => {
    if (!sessionId) return
    const on = (e: Event): void => {
      const d = (e as CustomEvent<{ sessionId?: string; action?: SourceAction }>).detail
      if (d?.sessionId === sessionId && d.action) actionRef.current(d.action)
    }
    window.addEventListener(SOURCE_ACTION_EVENT, on)
    return () => window.removeEventListener(SOURCE_ACTION_EVENT, on)
  }, [sessionId])

  useLayoutEffect(() => {
    const card = cardRef.current
    const pane = card?.closest('main')
    if (!card || !pane) return
    const measure = (): void => {
      if (!card.clientWidth || !pane.clientHeight) return
      const overhead = card.offsetHeight - (ref.current?.offsetHeight ?? 56)
      setMaxHeight(
        Math.max(56, Math.floor(pane.clientHeight / 2) - overhead - (toolbarRef.current?.offsetHeight ?? 40)),
      )
      setCardWidth(card.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    observer.observe(pane)
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [style])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const previousScroll = el.scrollTop
    el.style.height = 'auto'
    const automaticMax = Math.min(LINE_HEIGHT * MAX_ROWS + paddingY, maxHeight)
    const height = Math.max(
      56,
      composerHeight === null ? Math.min(el.scrollHeight, automaticMax) : Math.min(composerHeight, maxHeight),
    )
    el.style.height = `${height}px`
    el.style.overflowY = el.scrollHeight > height ? 'auto' : 'hidden'
    if (composerHeight !== null) el.scrollTop = previousScroll
    setTextHeight(height)
  }, [text, composerHeight, maxHeight, cardWidth, paddingY])

  const remove = (id: string) => setItems(list => list.filter(a => a.id !== id))
  const files = items.filter(a => a.kind !== 'mode')
  const modes = items.filter(a => a.kind === 'mode')
  const hasText = text.trim().length > 0
  const running = !!live?.running
  const hasContent = hasText || images.length > 0
  const canSend = hasContent && !busy && !reading && !imageDraft.loading

  const addImages = (files: FileList | File[]): void => {
    const list = [...files]
    if (list.length === 0) return
    if (live?.engine && live.engine.caps.imageInput !== true) {
      setError(tr('composer.attachment.unsupportedEngine'))
      return
    }
    if (images.length + list.length > MAX_IMAGE_COUNT) {
      setError(tr('composer.attachment.tooMany'))
      return
    }
    if (
      images.reduce((sum, image) => sum + image.bytes, 0) + list.reduce((sum, file) => sum + file.size, 0) >
      MAX_IMAGE_TOTAL
    ) {
      setError(tr('composer.attachment.totalTooLarge'))
      return
    }
    setReading(n => n + 1)
    pendingReads.current++
    adding.current = adding.current.then(async () => {
      try {
        const loaded = await Promise.all(list.map(readImage))
        await updateImages(key, current => [...current, ...loaded])
        setError(null)
      } catch (error) {
        setError((error as Error).message)
      } finally {
        pendingReads.current--
        setReading(n => n - 1)
      }
    })
    void adding.current
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDraggingImages(false)
    addImages(event.dataTransfer.files)
  }

  const submit = async (): Promise<void> => {
    if (!live) {
      if (hasContent) comingSoon(translate('发送'))
      return
    }
    if (!canSend || submitting.current || pendingReads.current) return
    submitting.current = true
    const sent = text
    const imageSignature = images.map(image => image.id).join(',')
    if (submission.current?.text !== sent || submission.current.images !== imageSignature)
      submission.current = { text: sent, images: imageSignature, id: crypto.randomUUID() }
    setBusy(true)
    setError(null)
    try {
      await live.submit(sent, submission.current.id, images)
      setText(current => (current === sent ? '' : current))
      const sentIds = new Set(images.map(image => image.id))
      if (images.length) await updateImages(key, current => current.filter(image => !sentIds.has(image.id)))
      submission.current = null
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      submitting.current = false
      ref.current?.focus()
    }
  }

  const suggestion = live && !running && text === '' ? live.suggestion : null

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (commandQuery !== undefined && !commandDismissed) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setCommandDismissed(true)
        return
      }
      if (commandMatches.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key) && !e.shiftKey) {
        e.preventDefault()
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setCommandIndex(
            index =>
              (Math.min(index, commandMatches.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + commandMatches.length) %
              commandMatches.length,
          )
        } else chooseCommand(activeCommandIndex)
        return
      }
    }
    // 输入建议：输入框为空时按 Tab 填入（docs/engines.md §15.5）
    if (e.key === 'Tab' && !e.shiftKey && suggestion) {
      e.preventDefault()
      setText(suggestion)
      return
    }
    // 输入法正在选字时的回车不是发送
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
  }

  return (
    <>
      {live && (
        <QueuedMessages
          live={live}
          onPrepareRecall={async recalled => {
            if (!recalled.attachments?.length) return
            const restored = new Set<string>()
            await updateImages(key, current => {
              const added = recalled.attachments!.filter(image => !current.some(existing => existing.id === image.id))
              added.forEach(image => restored.add(image.id))
              return [...current, ...added]
            })
            return () => updateImages(key, current => current.filter(image => !restored.has(image.id)))
          }}
          onRecall={recalled => {
            setText(current => (current && recalled ? `${current}\n${recalled}` : current || recalled))
            ref.current?.focus()
          }}
        />
      )}
      <ComposerStatusBar live={status} />
      <div data-composer-style={style} className={cn('composer-shell relative', chatgpt && CARD_STYLE)}>
        <div
          ref={cardRef}
          onDragEnter={e => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDraggingImages(true)
            }
          }}
          onDragOver={e => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingImages(false)
          }}
          onDrop={onDrop}
          className={cn('composer-core relative', !chatgpt && CARD_STYLE, draggingImages && 'ring-2 ring-accent')}
        >
          {draggingImages && (
            <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent-line bg-accent-soft/80 text-ui font-medium text-accent-fg">
              {tr('composer.attachment.drop')}
            </div>
          )}
          {commandQuery !== undefined && !commandDismissed && (
            <CommandMenu
              id={listId}
              commands={commandMatches}
              selected={activeCommandIndex}
              onChoose={chooseCommand}
              onSettings={() => {
                setCommandDismissed(true)
                settings.openSettings('plugins')
              }}
            />
          )}
          <ResizeHandle
            label={translate('调整输入框高度')}
            axis="y"
            className="composer-resize-top"
            scale={-1}
            value={textHeight}
            min={56}
            max={maxHeight}
            onChange={v => setLayoutSize('composerHeight', v)}
            onCommit={v => setLayoutSize('composerHeight', v, true)}
            onCancel={() => setLayoutSize('composerHeight', composerHeight, true)}
            onReset={() => setLayoutSize('composerHeight', null, true)}
          />
          {live && (
            <SourceHintBar
              live={live}
              confirm={confirmSource}
              onCancelConfirm={() => setConfirmSource(null)}
              onRequestSource={requestSource}
              onOpenMenu={() => setMenuOpen(true)}
            />
          )}
          {items.length > 0 && (
            <div className="flex flex-col gap-2 px-4 pt-3.5">
              {[files, modes]
                .filter(row => row.length > 0)
                .map((row, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    {row.map(a => (
                      <AttachmentChip key={a.id} attachment={a} onRemove={() => remove(a.id)} />
                    ))}
                  </div>
                ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="px-4 pt-3.5">
              <ImageAttachments
                images={images}
                onRemove={id => {
                  void imageDraft
                    .update(current => current.filter(image => image.id !== id))
                    .catch(error => setError((error as Error).message))
                }}
              />
            </div>
          )}
          {!!reading && (
            <p role="status" className="px-4 pt-2 text-meta text-fg-muted">
              {tr('composer.attachment.loading')}
            </p>
          )}
          {imageDraft.error && (
            <p role="status" className="px-4 pt-2 text-meta text-danger">
              {translateMessage(imageDraft.error)}
            </p>
          )}

          <div className="composer-input-row flex min-w-0 items-end">
            <textarea
              ref={ref}
              rows={1}
              aria-controls={commandMatches.length ? listId : undefined}
              aria-activedescendant={commandMatches.length ? `${listId}-${activeCommandIndex}` : undefined}
              value={text}
              autoFocus={autoFocus}
              onChange={e => {
                setText(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={onKeyDown}
              onPaste={event => {
                const files = [...event.clipboardData.files]
                if (files.length) {
                  event.preventDefault()
                  addImages(files)
                  const pasted = event.clipboardData.getData('text/plain')
                  if (pasted) {
                    const start = event.currentTarget.selectionStart,
                      end = event.currentTarget.selectionEnd
                    setText(current => current.slice(0, start) + pasted + current.slice(end))
                  }
                }
              }}
              placeholder={
                running
                  ? translate('继续补充要求，Enter 加入队列…')
                  : suggestion
                    ? `${suggestion}（${translate('按 Tab 填入')}）`
                    : translate(composer.placeholder)
              }
              className={cn(
                'block min-h-[56px] min-w-0 flex-1 resize-none bg-transparent px-4 pt-3.5 text-prose text-fg outline-none placeholder:text-fg-faint',
                chatgpt ? 'pb-2' : 'pb-3.5',
              )}
              style={{ lineHeight: `${LINE_HEIGHT}px` }}
            />
            <div
              className={cn(
                'composer-send-controls flex shrink-0 items-center gap-1',
                chatgpt ? 'absolute right-3 bottom-2.5' : 'pr-3 pb-3',
              )}
            >
              {/* 独立 key 保留停止与发送的点击目标语义。 */}
              {running && (
                <button
                  key="stop"
                  type="button"
                  aria-label={translate('停止')}
                  title={translate('停止当前任务并暂停队列')}
                  onClick={() => void live?.stop().catch((err: Error) => setError(err.message))}
                  className="press no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg hover:opacity-90"
                >
                  <Square size={12} strokeWidth={0} fill="currentColor" />
                </button>
              )}
              {(!running || hasContent) && (
                <button
                  key="send"
                  type="button"
                  aria-label={running ? translate('加入队列') : translate('发送')}
                  aria-disabled={!canSend}
                  title={running ? translate('加入队列（Enter）') : translate('发送（Enter）')}
                  onClick={() => void submit()}
                  className={cn(
                    'no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                    canSend
                      ? 'press bg-primary text-primary-fg hover:opacity-90'
                      : 'bg-disabled text-disabled-fg transition-colors',
                  )}
                >
                  <ArrowUp size={17} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="px-4 pb-1.5 text-meta whitespace-pre-wrap text-danger">{translateMessage(error)}</div>
          )}
        </div>

        <div
          ref={toolbarRef}
          className={cn(
            'composer-toolbar flex flex-wrap items-center gap-1',
            chatgpt ? cn('pl-2.5 pb-2.5', running && hasContent ? 'pr-[84px]' : 'pr-[48px]') : 'px-1 pt-1.5',
          )}
        >
          <span className="relative">
            <IconButton
              icon={Plus}
              label={tr('composer.attachment.addImageTitle')}
              size={32}
              active={addMenu}
              onClick={() => setAddMenu(value => !value)}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={event => {
                if (event.currentTarget.files) addImages(event.currentTarget.files)
                event.currentTarget.value = ''
                setAddMenu(false)
              }}
            />
            <Popover open={addMenu} onClose={() => setAddMenu(false)} className="bottom-full left-0 mb-2 w-44">
              <PopoverItem
                icon={<Plus size={15} strokeWidth={1.5} />}
                onClick={() => {
                  setAddMenu(false)
                  fileInput.current?.click()
                }}
              >
                {tr('composer.attachment.addImage')}
              </PopoverItem>
            </Popover>
          </span>
          {live ? (
            <PermissionMenu
              mode={live.permissionMode}
              modes={live.permissionModes}
              onSelect={live.setPermissionMode}
              engine={live.engine?.id}
            />
          ) : (
            <button
              type="button"
              title={translate('权限模式')}
              aria-label={translate('权限模式')}
              onClick={() => comingSoon(translate('权限模式'))}
              className="press no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-md text-warn hover:bg-hover"
            >
              <ShieldOff size={16} strokeWidth={1.5} />
            </button>
          )}

          <div className="flex-1" />

          {live ? (
            <>
              <ModelSourceMenu live={live} open={menuOpen} onOpenChange={setMenuOpen} onRequestSource={requestSource} />
              <EffortMenu live={live} />
            </>
          ) : (
            <>
              <ModelSourceMenu
                live={demoSource}
                open={menuOpen}
                onOpenChange={setMenuOpen}
                onRequestSource={s => void demoSource.setSource(s)}
              />
              <button
                type="button"
                onClick={() => comingSoon(translate('推理强度'))}
                className="press no-drag inline-flex h-8 items-center gap-1 rounded-md px-2 text-list text-fg-secondary hover:bg-hover hover:text-fg"
              >
                <span>{composer.effort}</span>
                <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
              </button>
            </>
          )}
          <IconButton
            icon={Mic}
            label={translate('语音输入')}
            size={32}
            onClick={() => comingSoon(translate('语音输入'))}
          />
          <ContextWindowButton sessionId={sessionId} />
        </div>
      </div>
    </>
  )
}
